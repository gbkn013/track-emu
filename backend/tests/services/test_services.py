from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

import httpx
import pytest
import respx

from ...app.core.config import Settings
from ...app.core.timeutil import IST, utcnow
from ...app.domain.models import LiveRun, RouteStop
from ...app.providers.base import QuotaExceeded, UpstreamDegraded
from ...app.providers.railradar import RailRadarProvider, map_live
from ...app.services.livecache import LiveCache
from ...app.services.queries import Catalogue, QueryService, align_live
from ...app.services.quota import BudgetState, QuotaLedger
from ..fakes import FakeLive, FakeStatic, schedules


def settings(tmp_path, **kw) -> Settings:
    base = dict(
        Settings.load().__dict__,
        ledger_path=tmp_path / "l.jsonl",
        monthly_request_budget=10,
    )
    base.update(kw)
    return Settings(**base)


async def make_svc(tmp_path, live=None, **kw) -> QueryService:
    st = FakeStatic()
    s = settings(tmp_path, **kw)
    return QueryService(
        s, await Catalogue.load(st), st, live, QuotaLedger(s.ledger_path, s.monthly_request_budget)
    )


def at(h, m, day=21):
    return datetime(2026, 9, day, h, m, tzinfo=IST)


# --- journeys (schedule-only) ------------------------------------------------


async def test_journeys_direction_and_halts(tmp_path):
    svc = await make_svc(tmp_path)
    r = await svc.journeys("MSB", "TBM", at(5, 0))
    assert [j["number"] for j in r["journeys"]] == ["40001"]  # 40002 wrong way, 40003 skips TBM
    assert r["data_mode"] == "scheduled" and r["journeys"][0]["source_at_a"] == "scheduled"
    r2 = await svc.journeys("TBM", "MSB", at(5, 0))
    assert [j["number"] for j in r2["journeys"]] == ["40002"]


async def test_midnight_crossing_belongs_to_previous_day(tmp_path):
    svc = await make_svc(tmp_path)
    r = await svc.journeys("MAS", "TRT", at(23, 35))
    j = r["journeys"][0]
    assert j["number"] == "43501" and j["start_date"] == "2026-09-21"
    assert j["eta_at_b"].startswith("2026-09-22T00:25")  # B is reached after midnight
    # After midnight the run is still keyed to the 21st, and still in progress.
    t = await svc.train_live("43501", at(0, 10, day=22))
    assert t["start_date"] == "2026-09-21" and t["position"]["kind"] == "between"
    assert t["position"]["estimated"] is True


async def test_departed_hidden_unless_toggled(tmp_path):
    svc = await make_svc(tmp_path)
    assert (await svc.journeys("MSB", "TBM", at(7, 0)))["journeys"] == []
    shown = await svc.journeys("MSB", "TBM", at(6, 0), show_departed=True)
    assert [j["state_relative_to_a"] for j in shown["journeys"]] == ["departed"]


# --- live overlay & degradation ---------------------------------------------


async def test_live_overlay_is_board_first_and_labels_sources(tmp_path):
    live = FakeLive()
    svc = await make_svc(tmp_path, live)
    # Board(TBM) says 40001 is 7 min late at TBM (sched 06:20). One call covers all trains.
    r = await svc.journeys("TBM", "CGL", at(6, 10))
    j = r["journeys"][0]
    assert j["delay_at_a"] == 7 and j["eta_at_a"].startswith("2026-09-21T06:27")
    assert j["source_at_a"] == "live_reported"
    assert j["source_at_b"] == "propagated"  # carried delay is never labelled reported
    assert j["eta_at_b"].startswith("2026-09-21T07:17")  # 07:10 + 7
    assert live.board_calls == 1 and live.calls == 0  # no per-train calls
    assert "railradar live" in r["source"] and r["data_mode"] != "scheduled"
    # Trains the board doesn't mention stay honestly scheduled.
    live.board_entries = []
    svc.cache._data.clear()
    r2 = await svc.journeys("TBM", "CGL", at(6, 10))
    assert r2["journeys"][0]["source_at_a"] == "scheduled" and r2["data_mode"] == "scheduled"


async def test_board_entry_for_the_other_run_date_is_not_applied(tmp_path):
    from ...app.domain.models import BoardEntry

    live = FakeLive()
    # Board says 40001 departs at 20:00 (a different run than the 06:20 one): must not match.
    live.board_entries = [
        BoardEntry(
            train_number="40001",
            live_type="upcoming",
            delay_minutes=5,
            expected_departure_time=at(20, 0),
        )
    ]
    svc = await make_svc(tmp_path, live)
    r = await svc.journeys("TBM", "CGL", at(6, 10))
    assert r["journeys"][0]["source_at_a"] == "scheduled"


async def test_single_flight_and_ttl_cache(tmp_path):
    live = FakeLive()
    svc = await make_svc(tmp_path, live)
    await asyncio.gather(*(svc.journeys("MSB", "TBM", at(5, 25)) for _ in range(5)))
    assert live.board_calls == 1  # 5 concurrent requests, one upstream call
    await svc.journeys("MSB", "TBM", at(5, 26))
    assert live.board_calls == 1  # within TTL: served from cache


async def test_train_detail_uses_per_train_live_only_when_opened(tmp_path):
    live = FakeLive()
    svc = await make_svc(tmp_path, live)
    t = await svc.train_live("40001", at(5, 50))
    assert (
        live.calls == 1
        and t["stops"][0]["eta_source"] == "actual"
        and t["stops"][0]["delay_min"] == 12
    )


@pytest.mark.parametrize("err", [QuotaExceeded(retry_after_s=60), UpstreamDegraded()])
async def test_upstream_failure_degrades_to_scheduled_never_errors(tmp_path, err):
    svc = await make_svc(tmp_path, FakeLive(fail=err))
    r = await svc.journeys("MSB", "TBM", at(5, 25))
    assert r["data_mode"] == "scheduled" and r["journeys"][0]["source_at_a"] == "scheduled"
    assert svc.cache.breaker_open


async def test_budget_exhausted_disables_live(tmp_path):
    live = FakeLive()
    svc = await make_svc(tmp_path, live, monthly_request_budget=1)
    svc.ledger.record("/x", 200, 5)
    assert svc.ledger.state() is BudgetState.EXHAUSTED
    r = await svc.journeys("MSB", "TBM", at(5, 25))
    assert live.board_calls == 0 and r["data_mode"] == "scheduled" and r["live_configured"] is False


async def test_board_overlay_marks_live_reported(tmp_path):
    svc = await make_svc(tmp_path, FakeLive())
    b = await svc.board("TBM", at(6, 15))
    row = next(t for t in b["trains"] if t["number"] == "40001")
    assert row["eta_source"] == "live_reported" and row["delay_min"] == 7 and row["platform"] == 3
    assert b["data_mode"] == "partial"


def test_align_live_rekeys_by_station_and_drops_unknown():
    sch = schedules()[0]
    live = LiveRun(
        number="40001",
        start_date=at(5, 0).date(),
        route=[
            RouteStop(seq=0, station_code="ZZZ"),
            RouteStop(seq=1, station_code="TBM"),
        ],
    )
    out = align_live(live, sch)
    assert [(r.station_code, r.seq) for r in out.route] == [("TBM", 1)]


# --- cache / quota -----------------------------------------------------------


async def test_stale_served_only_within_max_stale():
    c = LiveCache(max_stale_s=1000)
    assert (await c.get("k", 0, _ok)).value == 1

    async def boom():
        raise UpstreamDegraded()

    got = await c.get("k", 0, boom)  # ttl 0 -> refetch fails -> stale served
    assert got is not None and got.value == 1
    c._data["k"].fetched_mono -= 2000
    assert await c.get("k", 0, boom) is None


async def _ok():
    return 1


def test_ledger_states_and_monthly_count(tmp_path):
    led = QuotaLedger(tmp_path / "q.jsonl", 10)
    assert led.state() is BudgetState.OK
    for _ in range(9):
        led.record("/e", 200, 1)
    assert led.state() is BudgetState.STRETCH and led.used_this_month() == 9
    led.record("/e", 429, 1)
    assert led.state() is BudgetState.EXHAUSTED


# --- RailRadar provider (synthetic payloads; UNVERIFIED shape) ---------------


def test_map_live_tolerates_missing_and_extra_fields():
    run = map_live(
        "43501",
        at(5, 0).date(),
        {
            "isLive": True,
            "lastUpdatedAt": "2026-09-21T06:05:00+05:30",
            "surprise": 1,
            "currentLocation": {"stationCode": "TBM", "isActualPosition": False},
            "route": [
                {
                    "stationCode": "TBM",
                    "actualArrival": "2026-09-21T06:04:00+05:30",
                    "delayMinutes": 4,
                },
                "garbage",
            ],
            "exceptions": [{"type": "DIVERTED"}],
        },
    )
    assert run.is_live and run.route[0].delay_minutes == 4 and len(run.route) == 1
    assert run.exceptions[0].type == "DIVERTED"
    assert map_live("1", at(5, 0).date(), {}).route == []  # empty payload: no crash


@respx.mock
async def test_railradar_429_503_mapping_and_ledger(tmp_path):
    seen = []
    p = RailRadarProvider("k", ledger=lambda e, s, ms: seen.append((e, s)))
    respx.get("https://api.railradar.in/v1/trains/43501/live").mock(
        side_effect=[httpx.Response(429, headers={"retry-after": "30"}), httpx.Response(503)]
    )
    with pytest.raises(QuotaExceeded) as ei:
        await p.get_live_run("43501")
    assert ei.value.retry_after_s == 30
    with pytest.raises(UpstreamDegraded):
        await p.get_live_run("43501")
    assert seen == [("/trains/43501/live", 429), ("/trains/43501/live", 503)]


def test_no_key_refuses_to_construct():
    from ...app.providers.base import ProviderError

    with pytest.raises(ProviderError):
        RailRadarProvider("")


def test_utcnow_is_aware():
    assert utcnow().utcoffset() == timedelta(hours=5, minutes=30)
