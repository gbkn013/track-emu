"""Catalogue + query services (AGENTS.md §6.3–6.5).

Schedule-first: every answer is computable from the static timetable alone, and a
live overlay (when configured, within budget, and fresh) upgrades individual ETAs.
Live values are never fabricated; failures degrade to ``data_mode="scheduled"``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from ..core.config import Settings
from ..core.timeutil import age_seconds, combine_ist, in_ist, utcnow
from ..domain.models import (
    DataMode,
    LiveRun,
    RouteStop,
    Station,
    StationBoard,
    TrainSchedule,
)
from ..eta.engine import (
    JourneyResult,
    RunEta,
    StopEta,
    compute_run_eta,
    journey_between,
)
from ..providers.base import ProviderError, RailDataProvider
from .livecache import LiveCache
from .quota import BudgetState, QuotaLedger

log = logging.getLogger(__name__)

TIMETABLE_NOTE = (
    "Timetable from the open datameet dataset (~2016). Run days are unknown, so trains are "
    "assumed to run daily; times and services may be out of date."
)


@dataclass
class Catalogue:
    schedules: dict[str, TrainSchedule] = field(default_factory=dict)
    stations: dict[str, Station] = field(default_factory=dict)
    by_station: dict[str, list[str]] = field(default_factory=dict)

    @classmethod
    async def load(cls, provider: RailDataProvider) -> Catalogue:
        cat = cls()
        for s in await provider.list_stations():
            cat.stations[s.code] = s
        for ref in await provider.list_local_trains("Chennai"):
            try:
                sch = await provider.get_schedule(ref.number)
            except (ProviderError, NotImplementedError) as e:
                log.warning("skip schedule %s: %s", ref.number, e)
                continue
            cat.schedules[sch.number] = sch
            for st in sch.stops:
                cat.by_station.setdefault(st.station_code, []).append(sch.number)
        return cat

    def station_name(self, code: str) -> str:
        s = self.stations.get(code)
        return s.name if s else code


def align_live(live: LiveRun, schedule: TrainSchedule) -> LiveRun:
    """Re-key upstream route rows to the schedule's seq by station code, dropping
    stations the schedule doesn't know (upstream indices != schedule indices)."""
    seq_of: dict[str, int] = {}
    for st in schedule.stops:
        seq_of.setdefault(st.station_code, st.seq)
    rows: list[RouteStop] = []
    seen: set[int] = set()
    for r in live.route:
        seq = seq_of.get(r.station_code)
        if seq is None or seq in seen:
            continue
        seen.add(seq)
        rows.append(r.model_copy(update={"seq": seq}))
    return live.model_copy(update={"route": rows})


def _iso(dt: datetime | None) -> str | None:
    return in_ist(dt).isoformat() if dt else None


def _stop_json(s: StopEta, cat: Catalogue) -> dict:
    return {
        "seq": s.seq,
        "station_code": s.station_code,
        "station_name": cat.station_name(s.station_code),
        "scheduled": _iso(s.scheduled),
        "eta": _iso(s.eta),
        "eta_source": s.eta_source.value,
        "delay_min": s.delay_min,
        "confidence": s.confidence.value,
        "state": s.state,
        "stale": s.stale,
        "estimated": s.estimated,
        "platform": s.platform,
    }


class QueryService:
    def __init__(
        self,
        settings: Settings,
        catalogue: Catalogue,
        static_provider: RailDataProvider,
        live_provider: RailDataProvider | None = None,
        ledger: QuotaLedger | None = None,
    ) -> None:
        self.s, self.cat, self.static = settings, catalogue, static_provider
        self.live = live_provider
        self.ledger = ledger
        self.cache = LiveCache(max_stale_s=settings.max_stale_seconds)

    # -- helpers ----------------------------------------------------------- #

    def live_enabled(self) -> bool:
        return (
            self.live is not None
            and self.live.supports_live
            and (self.ledger is None or self.ledger.state() is not BudgetState.EXHAUSTED)
        )

    def _ttl(self, base: int) -> float:
        stretched = self.ledger is not None and self.ledger.state() is BudgetState.STRETCH
        return base * (3 if stretched else 1)

    def _meta(self, now: datetime, live_used: bool, stale: int | None) -> dict:
        sources = ["datameet timetable"] + (["railradar live"] if live_used else [])
        return {
            "fetched_at": _iso(now),
            "source": " + ".join(sources),
            "stale_seconds": stale,
            "timetable_note": TIMETABLE_NOTE,
            "live_configured": self.live_enabled(),
        }

    def run_dates(self, now: datetime) -> list[date]:
        """Journey dates that can still be running now: yesterday (midnight rollover) + today."""
        d = now.date()
        return [d - timedelta(days=1), d]

    async def _live_run(self, sch: TrainSchedule, start: date) -> tuple[LiveRun, float] | None:
        if not self.live_enabled():
            return None
        assert self.live is not None
        key = f"live:{sch.number}:{start.isoformat()}"
        c = await self.cache.get(
            key,
            self._ttl(self.s.train_live_ttl_s),
            lambda: self.live.get_live_run(sch.number, start),
        )
        if c is None:
            return None
        return align_live(c.value, sch), c.age()

    # -- catalogue --------------------------------------------------------- #

    def search_stations(self, q: str, limit: int = 15) -> list[dict]:
        ql = q.strip().lower()
        out = [
            s
            for s in self.cat.stations.values()
            if s.code in self.cat.by_station
            and (not ql or ql in s.name.lower() or ql == s.code.lower())
        ]
        out.sort(key=lambda s: (not s.name.lower().startswith(ql), s.name))
        return [{"code": s.code, "name": s.name, "lat": s.lat, "lng": s.lng} for s in out[:limit]]

    def search_trains(self, q: str, limit: int = 30) -> list[dict]:
        ql = q.strip().lower()
        out = [
            t
            for t in self.cat.schedules.values()
            if not ql or ql in t.number or ql in t.name.lower()
        ]
        out.sort(key=lambda t: t.number)
        return [self._train_brief(t) for t in out[:limit]]

    def _train_brief(self, t: TrainSchedule) -> dict:
        return {
            "number": t.number,
            "name": t.name,
            "kind": t.kind.value,
            "from": t.source,
            "to": t.destination,
            "from_name": self.cat.station_name(t.source or ""),
            "to_name": self.cat.station_name(t.destination or ""),
        }

    def train_schedule_json(self, t: TrainSchedule) -> dict:
        d = self.run_dates(utcnow())[1]
        run = compute_run_eta(
            t, None, combine_ist(d, t.origin_dep) - timedelta(hours=1), start_date=d
        )
        return {
            **self._train_brief(t),
            "run_days_known": bool(t.run_days),
            "stops": [_stop_json(s, self.cat) for s in run.stops],
        }

    # -- journeys ---------------------------------------------------------- #

    async def journeys(
        self,
        frm: str,
        to: str,
        now: datetime,
        *,
        limit: int = 10,
        horizon_h: int = 6,
        show_departed: bool = False,
    ) -> dict:
        cands: list[tuple[TrainSchedule, date, RunEta, JourneyResult]] = []
        for num in set(self.cat.by_station.get(frm, [])) & set(self.cat.by_station.get(to, [])):
            sch = self.cat.schedules[num]
            for d in self.run_dates(now):
                run = compute_run_eta(
                    sch, None, now, start_date=d, stale_after_seconds=self.s.stale_after_seconds
                )
                j = journey_between(sch, run, frm, to, now=now)
                if j is not None:
                    cands.append((sch, d, run, j))
        cands = self._window(cands, now, horizon_h, show_departed)

        live_used, stale = False, None
        for i, (sch, d, _run, _j) in enumerate(cands[: self.s.live_overlay_max]):
            res = await self._live_run(sch, d)
            if res is None:
                continue
            live, age = res
            run = compute_run_eta(
                sch, live, now, start_date=d, stale_after_seconds=self.s.stale_after_seconds
            )
            j = journey_between(sch, run, frm, to, now=now)
            if j is not None:
                cands[i] = (sch, d, run, j)
                live_used = True
                this = age_seconds(live.last_updated_at, now) if live.last_updated_at else int(age)
                stale = max(stale or 0, this)
        cands = self._window(cands, now, horizon_h, show_departed)[:limit]

        modes = {j.data_mode for *_, j in cands}
        mode = (
            DataMode.LIVE
            if modes == {DataMode.LIVE}
            else (DataMode.SCHEDULED if modes <= {DataMode.SCHEDULED} else DataMode.PARTIAL)
        )
        return {
            "from": frm,
            "to": to,
            "data_mode": mode.value,
            **self._meta(now, live_used, stale),
            "journeys": [self._journey_json(sch, d, j) for sch, d, _r, j in cands],
        }

    @staticmethod
    def _window(cands, now, horizon_h, show_departed):
        end = now + timedelta(hours=horizon_h)
        start = now - timedelta(minutes=60 if show_departed else 10)
        keep = [
            c
            for c in cands
            if start <= c[3].eta_at_a <= end
            and (show_departed or c[3].state_relative_to_a != "departed")
        ]
        keep.sort(key=lambda c: c[3].eta_at_a)
        return keep

    def _journey_json(self, sch: TrainSchedule, d: date, j: JourneyResult) -> dict:
        return {
            "number": j.number,
            "name": j.name,
            "kind": sch.kind.value,
            "start_date": d.isoformat(),
            "eta_at_a": _iso(j.eta_at_a),
            "eta_at_b": _iso(j.eta_at_b),
            "expected_ride_min": j.expected_ride_min,
            "delay_at_a": j.delay_at_a,
            "state_relative_to_a": j.state_relative_to_a,
            "platform_at_a": j.platform_at_a,
            "source_at_a": j.source_at_a.value,
            "source_at_b": j.source_at_b.value,
            "data_mode": j.data_mode.value,
            "to_name": self.cat.station_name(sch.destination or ""),
        }

    # -- train detail ------------------------------------------------------ #

    def active_date(self, sch: TrainSchedule, now: datetime) -> date:
        for d in self.run_dates(now):
            run = compute_run_eta(sch, None, now, start_date=d)
            if run.stops and combine_ist(d, sch.origin_dep) - timedelta(
                minutes=30
            ) <= now <= run.stops[-1].eta + timedelta(minutes=30):
                return d
        return now.date()

    async def train_live(self, number: str, now: datetime, on: date | None = None) -> dict:
        sch = self.cat.schedules[number]
        d = on or self.active_date(sch, now)
        res = await self._live_run(sch, d)
        live, age = res if res else (None, None)
        run = compute_run_eta(
            sch, live, now, start_date=d, stale_after_seconds=self.s.stale_after_seconds
        )
        pos = run.position
        stale = run.stale_seconds if live else None
        return {
            **self._train_brief(sch),
            "start_date": d.isoformat(),
            "data_mode": run.data_mode.value,
            **self._meta(now, live is not None, stale),
            "position": {
                "kind": pos.kind.value,
                "station_code": pos.station_code,
                "prev_station": pos.prev_station,
                "next_station": pos.next_station,
                "progress": pos.progress,
                "estimated": pos.estimated,
            },
            "stops": [_stop_json(s, self.cat) for s in run.stops],
            "exceptions": [{"type": e.type, "payload": e.payload} for e in run.exceptions],
            "cache_age_s": age,
        }

    async def route_geometry(self, number: str) -> dict:
        return (await self.static.get_route_geometry(number)).to_dict()

    # -- station board ----------------------------------------------------- #

    async def board(self, code: str, now: datetime, hours: int = 2) -> dict:
        rows: list[dict] = []
        for num in set(self.cat.by_station.get(code, [])):
            sch = self.cat.schedules[num]
            for d in self.run_dates(now):
                run = compute_run_eta(sch, None, now, start_date=d)
                st = run.stop(code)
                if st is None or not (
                    now - timedelta(minutes=15) <= st.eta <= now + timedelta(hours=hours)
                ):
                    continue
                rows.append(
                    {
                        "number": num,
                        "name": sch.name,
                        "start_date": d.isoformat(),
                        "to": sch.destination,
                        "to_name": self.cat.station_name(sch.destination or ""),
                        "is_terminus": st.seq == sch.stops[-1].seq,
                        "scheduled": _iso(st.scheduled),
                        "eta": _iso(st.eta),
                        "delay_min": None,
                        "eta_source": "scheduled",
                        "platform": None,
                        "state": st.state,
                    }
                )
        live_used, stale = False, None
        board = await self._live_board(code, hours)
        if board is not None:
            live_board, age = board
            by_num = {e.train_number: e for e in live_board.entries}
            for r in rows:
                e = by_num.get(r["number"])
                if e is not None and e.delay_minutes is not None:
                    sched = datetime.fromisoformat(r["scheduled"])
                    r["delay_min"] = e.delay_minutes
                    r["eta"] = _iso(sched + timedelta(minutes=e.delay_minutes))
                    r["eta_source"] = "live_reported"
                    r["platform"] = e.platform
                    live_used, stale = True, int(age)
        rows.sort(key=lambda r: r["eta"])
        mode = "scheduled" if not live_used else "partial"
        return {
            "code": code,
            "name": self.cat.station_name(code),
            "hours": hours,
            "data_mode": mode,
            **self._meta(now, live_used, stale),
            "trains": rows,
        }

    async def _live_board(self, code: str, hours: int) -> tuple[StationBoard, float] | None:
        if not self.live_enabled():
            return None
        assert self.live is not None
        c = await self.cache.get(
            f"board:{code}:{hours}",
            self._ttl(self.s.station_board_ttl_s),
            lambda: self.live.get_station_board(code, hours),
        )
        return (c.value, c.age()) if c else None

    # -- status ------------------------------------------------------------ #

    def status(self) -> dict:
        used = self.ledger.used_this_month() if self.ledger else 0
        return {
            "static_source": self.static.name,
            "live_source": self.live.name if self.live else "none",
            "trains": len(self.cat.schedules),
            "stations": len(self.cat.stations),
            "quota": {
                "used_this_month": used,
                "budget": self.s.monthly_request_budget,
                "state": self.ledger.state().value if self.ledger else "n/a",
            },
            "cache": {
                "hits": self.cache.hits,
                "misses": self.cache.misses,
                "breaker_open": self.cache.breaker_open,
                "last_error": self.cache.last_error,
            },
        }
