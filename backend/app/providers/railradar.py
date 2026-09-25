"""RailRadar provider (AGENTS.md §3.1) — live data. Spends quota.

UNVERIFIED: field names come from the vendor docs summary in AGENTS.md, not from
recorded responses (Phase 0 has not been run). Mapping is deliberately tolerant:
missing/renamed fields yield ``None`` rather than exceptions, and unexpected shapes
are logged as drift. Re-check every ``_pick`` alias against real fixtures.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from datetime import date, datetime
from typing import Any

import httpx

from ..core.timeutil import in_ist, utcnow
from ..domain.models import (
    BoardEntry,
    CurrentLocation,
    GeoJSONLine,
    LiveRun,
    RouteStop,
    RunException,
    RunStatus,
    Station,
    StationBoard,
    TrainRef,
    TrainSchedule,
)
from .base import ProviderError, QuotaExceeded, RailDataProvider, UpstreamDegraded

log = logging.getLogger(__name__)
BASE_URL = "https://api.railradar.in/v1"

#: ledger hook: (endpoint, status, latency_ms) — the caller persists it.
LedgerHook = Callable[[str, int, int], None]


def _pick(d: dict[str, Any], *names: str) -> Any:
    for n in names:
        if n in d and d[n] is not None:
            return d[n]
    return None


def _dt(v: Any) -> datetime | None:
    if not isinstance(v, str):
        return None
    try:
        return in_ist(datetime.fromisoformat(v.replace("Z", "+00:00")))
    except ValueError:
        return None


def _int(v: Any) -> int | None:
    try:
        return None if v is None else int(round(float(v)))
    except (TypeError, ValueError):
        return None


_STATUS = {
    "cancelled": RunStatus.CANCELLED,
    "canceled": RunStatus.CANCELLED,
    "diverted": RunStatus.DIVERTED,
    "partially_cancelled": RunStatus.PARTIALLY_CANCELLED,
    "completed": RunStatus.COMPLETED,
    "scheduled": RunStatus.SCHEDULED,
}


def map_live(number: str, start: date, data: dict[str, Any]) -> LiveRun:
    """Vendor ``/trains/{n}/live`` ``data`` -> :class:`LiveRun` (tolerant)."""
    loc_raw = data.get("currentLocation") or {}
    loc = (
        CurrentLocation(
            station_code=_pick(loc_raw, "stationCode"),
            status=_pick(loc_raw, "status"),
            is_actual_position=bool(loc_raw.get("isActualPosition", False)),
            segment_progress=_pick(loc_raw, "segmentProgress"),
            speed_kmh=_pick(loc_raw, "speedKmh"),
            bearing_degrees=_pick(loc_raw, "bearingDegrees"),
        )
        if loc_raw
        else None
    )

    def stop_code(v: Any) -> str | None:
        return v.get("stationCode") if isinstance(v, dict) else v

    route = []
    for i, r in enumerate(data.get("route") or []):
        if not isinstance(r, dict):
            log.warning("schema drift: non-dict route row")
            continue
        route.append(
            RouteStop(
                seq=i,  # re-aligned to the schedule by station code in the service layer
                station_code=str(_pick(r, "stationCode", "code") or ""),
                station_name=_pick(r, "stationName", "name"),
                status=_pick(r, "status"),
                scheduled_arrival=_dt(_pick(r, "scheduledArrival")),
                scheduled_departure=_dt(_pick(r, "scheduledDeparture")),
                actual_arrival=_dt(_pick(r, "actualArrival")),
                actual_departure=_dt(_pick(r, "actualDeparture")),
                delay_minutes=_int(
                    _pick(r, "delayArrivalMinutes", "arrivalDelayMinutes", "delayMinutes")
                ),
                platform=_int(_pick(r, "platform")),
            )
        )
    status_raw = str(_pick(data, "status") or "").lower().replace(" ", "_")
    return LiveRun(
        number=number,
        start_date=start,
        status=_STATUS.get(status_raw, RunStatus.RUNNING),
        is_live=bool(data.get("isLive", False)),
        last_updated_at=_dt(_pick(data, "lastUpdatedAt")),
        delay_minutes=_int(_pick(data, "delayMinutes")),
        current_location=loc,
        previous_halt=stop_code(data.get("previousHalt")),
        next_halt=stop_code(data.get("nextHalt")),
        route=route,
        exceptions=[
            RunException(type=str(_pick(x, "type") or "UNKNOWN"), payload=x)
            for x in (data.get("exceptions") or [])
            if isinstance(x, dict)
        ],
    )


def map_board(code: str, data: dict[str, Any]) -> StationBoard:
    entries = []
    for t in _pick(data, "trains", "entries") or []:
        if not isinstance(t, dict):
            continue
        live = t.get("live") or {}
        num = _pick(t, "trainNumber", "number")
        if num is None:
            continue
        entries.append(
            BoardEntry(
                train_number=str(num),
                train_name=_pick(t, "trainName", "name"),
                live_type=str(_pick(live, "type") or "scheduled"),
                expected_departure_time=_dt(_pick(live, "expectedDepartureTime")),
                delay_minutes=_int(_pick(live, "delayMinutes")),
                platform=_int(_pick(live, "platform", "platformNumber") or _pick(t, "platform")),
            )
        )
    return StationBoard(code=code, station_name=_pick(data, "stationName", "name"), entries=entries)


class RailRadarProvider(RailDataProvider):
    name = "railradar"

    def __init__(
        self,
        api_key: str,
        *,
        ledger: LedgerHook | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not api_key:
            raise ProviderError("RAILRADAR_API_KEY is not set", code="no_api_key")
        self._ledger = ledger
        self._client = client or httpx.AsyncClient(
            base_url=BASE_URL, headers={"Authorization": f"Bearer {api_key}"}, timeout=20
        )

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        t0 = time.monotonic()
        status = 0
        try:
            r = await self._client.get(path, params=params)
            status = r.status_code
        except httpx.HTTPError as e:
            raise UpstreamDegraded(f"network error: {type(e).__name__}") from e
        finally:
            if self._ledger:
                self._ledger(path, status, int((time.monotonic() - t0) * 1000))
        if status == 429:
            ra = r.headers.get("retry-after")
            raise QuotaExceeded(retry_after_s=int(ra) if ra and ra.isdigit() else None)
        if status >= 500:
            raise UpstreamDegraded(f"upstream {status}")
        if status != 200:
            raise ProviderError(f"upstream {status}", code="upstream_error", status=status)
        body = r.json()
        if not body.get("success", True):
            raise ProviderError("upstream reported failure", code="upstream_error")
        return body.get("data") or {}

    async def list_local_trains(self, city: str) -> list[TrainRef]:
        data = await self._get("/lookup/trains/local", {"city": city})
        return [TrainRef(number=str(k), name=str(v)) for k, v in data.items()]

    async def get_schedule(self, train_no: str) -> TrainSchedule:
        raise NotImplementedError("schedule mapping needs Phase 0 fixtures (unverified shape)")

    async def get_live_run(self, train_no: str, start_date: date | None = None) -> LiveRun:
        params = {"date": start_date.isoformat()} if start_date else None
        data = await self._get(f"/trains/{train_no}/live", params)
        return map_live(train_no, start_date or utcnow().date(), data)

    async def get_station_board(self, code: str, hours_ahead: int = 2) -> StationBoard:
        hours = min((h for h in (2, 4, 6, 8) if h >= hours_ahead), default=8)
        return map_board(code, await self._get(f"/stations/{code}/live", {"hours": hours}))

    async def get_route_geometry(self, train_no: str) -> GeoJSONLine:
        data = await self._get(f"/trains/{train_no}/route")
        geo = data.get("geometry", data)
        return GeoJSONLine(coordinates=geo.get("coordinates", []) if isinstance(geo, dict) else [])

    async def list_stations(self) -> list[Station]:
        data = await self._get("/lookup/stations")
        rows = data.values() if isinstance(data, dict) else data
        return [
            Station(
                code=str(r.get("code")), name=str(r.get("name")), lat=r.get("lat"), lng=r.get("lng")
            )
            for r in rows
            if isinstance(r, dict) and r.get("code")
        ]

    def describe(self) -> dict[str, Any]:
        return {"name": self.name, "verified_against_real_data": False}
