"""ETA engine test matrix (AGENTS.md §9 required cases + §6.4 guarantees).

All tests are offline and deterministic: ``now`` is an explicit parameter.
"""

from __future__ import annotations

from datetime import date, datetime, time

import pytest

from ...app.core.timeutil import IST, in_ist
from ...app.domain.models import CurrentLocation, RouteStop, TrainKind
from ...app.eta.engine import (
    STATE_UPCOMING,
    EtaSource,
    compute_run_eta,
    journey_between,
)
from .helpers import IST_DATE, make_live, make_schedule


def dt(y, mo, d, h, mi, s=0):
    return datetime.combine(datetime(y, mo, d).date(), time(h, mi, s), IST)


# A concrete south-line-ish train:
#   MSB 05:30 dep -> TBE 05:52 -> TBM 06:20 -> CGL 07:10 (terminus)
SCHEDULE = make_schedule(
    [
        ("MSB", None, 0, 0),
        ("TBE", 22, 24, 0),  # Tambaram... actually TBE is an example; keep codes generic
        ("TBM", 50, 55, 0),
        ("CGL", 100, None, 0),
    ],
    origin_dep=time(5, 30),
)


def test_on_time_all_scheduled_when_no_live():
    now = dt(2026, 9, 21, 8, 0)  # after the run finished on schedule
    run = compute_run_eta(SCHEDULE, None, now, start_date=IST_DATE)
    assert run.data_mode.value == "scheduled"
    # Every stop's ETA equals its scheduled arrival.
    for s in run.stops:
        assert s.eta_source is EtaSource.SCHEDULED
        assert s.eta == s.scheduled
    # CGL scheduled arrival = 05:30 + 100 min = 07:10
    cgl = run.stop("CGL")
    assert cgl is not None and cgl.eta.hour == 7 and cgl.eta.minute == 10


def test_not_started():
    now = dt(2026, 9, 21, 5, 0)  # before 05:30 origin dep
    run = compute_run_eta(SCHEDULE, None, now, start_date=IST_DATE)
    assert run.position.kind.value == "not_started"
    assert run.stop("MSB").eta < now or run.stop("TBE").eta > now


def test_delayed_train_carries_delay_forward():
    # Train departed MSB on time, but is 12 min late at TBE (actual 05:52+12=06:04).
    # Later stops should propagate +12 unless recovered.
    route = [
        RouteStop(
            seq=0,
            station_code="MSB",
            actual_departure=dt(2026, 9, 21, 5, 30),
            scheduled_departure=dt(2026, 9, 21, 5, 30),
        ),
        RouteStop(
            seq=1,
            station_code="TBE",
            actual_arrival=dt(2026, 9, 21, 6, 4),
            actual_departure=dt(2026, 9, 21, 6, 6),
            scheduled_arrival=dt(2026, 9, 21, 5, 52),
            delay_minutes=12,
        ),
    ]
    live = make_live(
        "43501",
        IST_DATE,
        last_updated_at="2026-09-21T06:07:00+05:30",
        previous_halt="TBE",
        next_halt="TBM",
        route=route,
    )
    now = dt(2026, 9, 21, 6, 8)
    run = compute_run_eta(SCHEDULE, live, now, start_date=IST_DATE)

    tbe = run.stop("TBE")
    assert tbe.eta_source is EtaSource.ACTUAL
    assert tbe.eta == dt(2026, 9, 21, 6, 4)

    # TBM: scheduled 06:20, propagated +12 -> 06:32
    tbm = run.stop("TBM")
    assert tbm.eta_source is EtaSource.PROPAGATED
    assert tbm.eta == dt(2026, 9, 21, 6, 32)
    assert tbm.delay_min == 12
    assert tbm.estimated is True


def test_recovery_reduces_carried_delay():
    route = [
        RouteStop(
            seq=1,
            station_code="TBE",
            actual_arrival=dt(2026, 9, 21, 6, 4),
            scheduled_arrival=dt(2026, 9, 21, 5, 52),
            delay_minutes=12,
        ),
    ]
    live = make_live("43501", IST_DATE, last_updated_at="2026-09-21T06:07:00+05:30", route=route)
    now = dt(2026, 9, 21, 6, 8)
    # 5 min recovery per segment: TBM is 1 segment after TBE -> 12-5 = 7 min late
    run = compute_run_eta(SCHEDULE, live, now, start_date=IST_DATE, recovery_min_per_segment=5.0)
    tbm = run.stop("TBM")
    assert tbm.eta == dt(2026, 9, 21, 6, 27)  # 06:20 + 7
    assert tbm.delay_min == 7


def test_eta_never_precedes_last_actual():
    # A reported ETA that is *before* the last actual must be clamped up.
    route = [
        RouteStop(
            seq=1,
            station_code="TBE",
            actual_arrival=dt(2026, 9, 21, 6, 40),
            scheduled_arrival=dt(2026, 9, 21, 5, 52),
            delay_minutes=48,
        ),
        # TBM 'reportedly' arrives 06:25 (before the 06:40 actual at TBE) — impossible.
        RouteStop(seq=2, station_code="TBM", delay_minutes=5),
    ]
    live = make_live("43501", IST_DATE, last_updated_at="2026-09-21T06:41:00+05:30", route=route)
    now = dt(2026, 9, 21, 6, 45)
    run = compute_run_eta(SCHEDULE, live, now, start_date=IST_DATE)
    assert run.stop("TBM").eta >= run.stop("TBE").eta  # never precedes last actual


def test_monotonic_stops_property():
    route = [
        RouteStop(seq=0, station_code="MSB", actual_departure=dt(2026, 9, 21, 5, 30)),
        RouteStop(seq=2, station_code="TBM", delay_minutes=-30),  # early!
    ]
    live = make_live("43501", IST_DATE, last_updated_at="2026-09-21T06:00:00+05:30", route=route)
    now = dt(2026, 9, 21, 6, 10)
    run = compute_run_eta(SCHEDULE, live, now, start_date=IST_DATE)
    etas = [s.eta for s in run.stops]
    assert etas == sorted(etas), "ETAs must be non-decreasing across stops"


def test_midnight_crossing():
    # West North line: departs Central 23:40, reaches Tiruttani (TRT) 00:25 next day.
    sched = make_schedule(
        [
            ("MAS", None, 0, 0),
            ("TRT", 45, None, 1),  # 45 min later, but day_offset=1 (past midnight)
        ],
        number="42564",
        origin_dep=time(23, 40),
        kind=TrainKind.MEMU,
    )
    now = dt(2026, 9, 21, 23, 50)  # running on the 21st, will pass midnight
    run = compute_run_eta(sched, None, now, start_date=IST_DATE)
    trt = run.stop("TRT")
    # Scheduled arrival = 23:40 + 45 min = 00:25 on the 22nd.
    assert trt.eta.date() == date(2026, 9, 22)
    assert trt.eta.hour == 0 and trt.eta.minute == 25
    # And it must be strictly after the origin departure instant.
    assert trt.eta > run.stop("MAS").eta


def test_journey_between_selects_halts_and_direction():
    now = dt(2026, 9, 21, 6, 0)
    run = compute_run_eta(SCHEDULE, None, now, start_date=IST_DATE)
    # TBM -> CGL is valid (both halts, A before B).
    j = journey_between(SCHEDULE, run, "TBM", "CGL", now=now)
    assert j is not None
    assert j.eta_at_a == run.stop("TBM").eta
    assert j.eta_at_b == run.stop("CGL").eta
    assert j.expected_ride_min == 50  # 06:20 -> 07:10
    assert j.state_relative_to_a == STATE_UPCOMING

    # Reverse direction CGL -> TBM is NOT served (wrong direction).
    assert journey_between(SCHEDULE, run, "CGL", "TBM", now=now) is None

    # A not a halt (e.g. a station not on this train).
    assert journey_between(SCHEDULE, run, "AVD", "CGL", now=now) is None


def test_stale_snapshot_downgrades_confidence():
    route = [
        RouteStop(
            seq=1, station_code="TBE", actual_arrival=dt(2026, 9, 21, 5, 52), delay_minutes=0
        ),
    ]
    # last_updated 30 minutes ago -> stale at default 300s
    live = make_live("43501", IST_DATE, last_updated_at="2026-09-21T05:30:00+05:30", route=route)
    now = dt(2026, 9, 21, 6, 0)
    run = compute_run_eta(SCHEDULE, live, now, start_date=IST_DATE)
    tbe = run.stop("TBE")
    assert tbe.stale is True
    # An ACTUAL stop normally high confidence; stale downgrades to medium.
    from ...app.domain.models import Confidence

    assert tbe.confidence is Confidence.MEDIUM
    assert run.stale_seconds is not None and run.stale_seconds > 300


def test_missing_actual_fields_falls_back_to_scheduled():
    # route present but no actuals/delays -> stops stay scheduled (not 'live').
    route = [
        RouteStop(seq=1, station_code="TBE", scheduled_arrival=dt(2026, 9, 21, 5, 52)),
    ]
    live = make_live("43501", IST_DATE, last_updated_at="2026-09-21T06:00:00+05:30", route=route)
    now = dt(2026, 9, 21, 6, 10)
    run = compute_run_eta(SCHEDULE, live, now, start_date=IST_DATE)
    # No actual to anchor propagation, so TBE stays scheduled.
    assert run.stop("TBE").eta_source is EtaSource.SCHEDULED
    assert run.data_mode.value in ("scheduled", "partial")


def test_cancelled_run():
    live = make_live(
        "43501",
        IST_DATE,
        status="cancelled",
        is_live=True,
        last_updated_at="2026-09-21T06:00:00+05:30",
    )
    now = dt(2026, 9, 21, 6, 10)
    run = compute_run_eta(SCHEDULE, live, now, start_date=IST_DATE)
    assert run.position.kind.value == "cancelled"


def test_position_between_with_actual_position():
    loc = CurrentLocation(
        is_actual_position=True, segment_progress=0.4, speed_kmh=42.0, bearing_degrees=120.0
    )
    route = [
        RouteStop(
            seq=1, station_code="TBE", actual_departure=dt(2026, 9, 21, 6, 0), delay_minutes=2
        ),
    ]
    live = make_live(
        "43501",
        IST_DATE,
        last_updated_at="2026-09-21T06:05:00+05:30",
        current_location=loc,
        previous_halt="TBE",
        next_halt="TBM",
        route=route,
    )
    now = dt(2026, 9, 21, 6, 6)
    run = compute_run_eta(SCHEDULE, live, now, start_date=IST_DATE)
    assert run.position.kind.value == "between"
    assert run.position.prev_station == "TBE"
    assert run.position.next_station == "TBM"
    assert run.position.progress == pytest.approx(0.4)
    assert run.position.estimated is False  # real instrumented position


def test_no_live_data_is_never_shown_as_live():
    run = compute_run_eta(SCHEDULE, None, dt(2026, 9, 21, 6, 0), start_date=IST_DATE)
    assert run.data_mode.value == "scheduled"
    for s in run.stops:
        assert s.eta_source is EtaSource.SCHEDULED
        assert s.estimated is False


def test_no_naive_datetimes_in_output():
    run = compute_run_eta(SCHEDULE, None, dt(2026, 9, 21, 6, 0), start_date=IST_DATE)
    for s in run.stops:
        assert s.eta.tzinfo is not None
        assert (s.scheduled is None) or s.scheduled.tzinfo is not None
    assert run.computed_at.tzinfo is not None


def test_isolated_ist_roundtrip():
    from datetime import datetime

    t = dt(2026, 9, 21, 6, 0)
    assert in_ist(t).utcoffset() is not None
    # 06:00 IST == 00:30 UTC
    utc = t.astimezone(__import__("datetime").timezone.utc)
    assert utc.hour == 0 and utc.minute == 30
    _ = datetime  # keep import for clarity


def test_origin_stop_is_a_valid_journey_start():
    """Regression: the origin has no arrival; it must still be queryable as A."""
    run = compute_run_eta(SCHEDULE, None, dt(2026, 9, 21, 5, 0), start_date=IST_DATE)
    msb = run.stop("MSB")
    assert msb is not None and msb.eta == dt(2026, 9, 21, 5, 30)
    j = journey_between(SCHEDULE, run, "MSB", "TBM")
    assert j is not None and j.expected_ride_min == 50


def test_propagation_applies_without_route_row_for_stop():
    """Regression: upstream route[] often lists only visited stops."""
    route = [
        RouteStop(
            seq=1,
            station_code="TBE",
            actual_arrival=dt(2026, 9, 21, 6, 4),
            scheduled_arrival=dt(2026, 9, 21, 5, 52),
            delay_minutes=12,
        )
    ]
    live = make_live("43501", IST_DATE, last_updated_at="2026-09-21T06:05:00+05:30", route=route)
    run = compute_run_eta(SCHEDULE, live, dt(2026, 9, 21, 6, 6), start_date=IST_DATE)
    cgl = run.stop("CGL")
    assert cgl.eta_source is EtaSource.PROPAGATED and cgl.eta == dt(2026, 9, 21, 7, 22)


def test_position_never_fabricates_progress():
    loc = CurrentLocation(station_code="TBE", is_actual_position=False)
    live = make_live(
        "43501",
        IST_DATE,
        last_updated_at="2026-09-21T06:05:00+05:30",
        current_location=loc,
        previous_halt="TBE",
        next_halt="TBM",
        route=[RouteStop(seq=1, station_code="TBE", actual_arrival=dt(2026, 9, 21, 6, 4))],
    )
    run = compute_run_eta(SCHEDULE, live, dt(2026, 9, 21, 6, 6), start_date=IST_DATE)
    if run.position.kind.value == "between":
        assert run.position.progress is None and run.position.estimated
