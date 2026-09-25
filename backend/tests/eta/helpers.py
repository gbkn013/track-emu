"""Small builders for ETA engine tests (deterministic, no I/O)."""

from __future__ import annotations

from datetime import date, time

from ...app.domain.models import (
    CurrentLocation,
    LiveRun,
    RouteStop,
    Stop,
    TrainKind,
    TrainSchedule,
)

IST_DATE = date(2026, 9, 21)  # a Monday


def make_schedule(
    stops: list[tuple[str, int | None, int | None, int]] = ...,
    *,
    number: str = "43501",
    name: str = "Chennai Beach - Chengalpattu EMU",
    origin_dep: time = time(5, 30),
    kind: TrainKind = TrainKind.EMU,
) -> TrainSchedule:
    """stops: list of (code, arr_offset_min, dep_offset_min, day_offset)."""
    if stops is Ellipsis:
        stops = []
    parsed = []
    for seq, (code, arr, dep, day) in enumerate(stops):
        parsed.append(
            Stop(
                seq=seq,
                station_code=code,
                arr_offset_min=arr,
                dep_offset_min=dep,
                day_offset=day,
            )
        )
    return TrainSchedule(
        number=number,
        name=name,
        kind=kind,
        origin_dep=origin_dep,
        stops=parsed,
    )


def make_live(
    number: str,
    start_date: date,
    *,
    is_live: bool = True,
    last_updated_at: str | None = None,
    status: str = "running",
    delay_minutes: int | None = None,
    current_location: CurrentLocation | None = None,
    previous_halt: str | None = None,
    next_halt: str | None = None,
    route: list[RouteStop] | None = None,
    exceptions: list | None = None,
) -> LiveRun:
    from datetime import datetime

    from ...app.core.timeutil import IST

    lu = None
    if last_updated_at is not None:
        lu = datetime.fromisoformat(last_updated_at)
        if lu.tzinfo is None:
            lu = lu.replace(tzinfo=IST)
    return LiveRun(
        number=number,
        start_date=start_date,
        is_live=is_live,
        last_updated_at=lu,
        status=status,
        delay_minutes=delay_minutes,
        current_location=current_location,
        previous_halt=previous_halt,
        next_halt=next_halt,
        route=route or [],
        exceptions=exceptions or [],
    )
