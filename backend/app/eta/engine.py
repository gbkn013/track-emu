"""Pure ETA computation (AGENTS.md §6.4).

Guarantees (also covered by property tests in ``tests/eta``):
- ETA at a later stop is never earlier than at an earlier stop (monotonic).
- An ETA never precedes the last recorded actual time.
- A scheduled time is NEVER upgraded to look live (§11).
- ``progress`` is only reported as real when upstream says ``is_actual_position``;
  otherwise it is interpolated from timing and flagged ``estimated``.
- No I/O, no ``datetime.now()`` — ``now`` is a parameter.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from ..core.timeutil import age_seconds, combine_ist, in_ist
from ..domain.models import (
    Confidence,
    DataMode,
    EtaSource,
    LiveRun,
    PositionKind,
    RouteStop,
    RunException,
    Stop,
    TrainSchedule,
)

# State of a stop relative to 'now'.
STATE_UPCOMING = "upcoming"
STATE_ARRIVING = "arriving"
STATE_AT_STATION = "at_station"
STATE_DEPARTED = "departed"
STATE_SKIPPED = "skipped"

#: A stop within this many minutes of now counts as 'arriving' (UI: big pulse).
ARRIVING_WINDOW_MIN = 10


@dataclass(frozen=True)
class StopEta:
    """The ETA for one stop of one run."""

    seq: int
    station_code: str
    eta: datetime  # best estimate of ARRIVAL at this stop (aware IST)
    eta_source: EtaSource
    delay_min: int | None  # vs scheduled arrival; None if not derivable
    confidence: Confidence
    state: str  # STATE_*
    stale: bool = False
    estimated: bool = False  # True when value is propagated/interpolated, not reported
    scheduled: datetime | None = None  # the timetable arrival, for display/audit
    platform: int | None = None  # reported platform (if upstream gave one)


@dataclass(frozen=True)
class Position:
    """Where the run currently is (AGENTS.md §6.4 position states)."""

    kind: PositionKind
    station_code: str | None = None  # for AT_STATION
    prev_station: str | None = None  # for BETWEEN
    next_station: str | None = None  # for BETWEEN
    progress: float | None = None  # 0..1, only meaningful for BETWEEN
    estimated: bool = False  # True when progress is interpolated, not instrumented


@dataclass(frozen=True)
class RunEta:
    """Per-stop ETAs + position for one run (number, start_date)."""

    number: str
    start_date: date
    computed_at: datetime
    data_mode: DataMode
    position: Position
    stops: tuple[StopEta, ...] = field(default_factory=tuple)
    stale_seconds: int | None = None
    exceptions: tuple[RunException, ...] = field(default_factory=tuple)

    def stop(self, code: str) -> StopEta | None:
        for s in self.stops:
            if s.station_code == code:
                return s
        return None


@dataclass(frozen=True)
class JourneyResult:
    """A→B result for one train (AGENTS.md §6.4)."""

    number: str
    name: str
    eta_at_a: datetime
    eta_at_b: datetime
    expected_ride_min: int
    delay_at_a: int | None
    state_relative_to_a: str  # STATE_UPCOMING | ARRIVING | AT_STATION | DEPARTED
    platform_at_a: int | None
    source_at_a: EtaSource
    source_at_b: EtaSource
    data_mode: DataMode

    def sort_key(self) -> datetime:
        return self.eta_at_a


# --------------------------------------------------------------------------- #
# Internals
# --------------------------------------------------------------------------- #


def _origin_dep(schedule: TrainSchedule, start_date: date) -> datetime | None:
    """The origin departure instant (aware IST) for the run starting on
    ``start_date``, or None if the schedule has no origin_dep time-of-day."""
    if schedule.origin_dep is None:
        return None
    return combine_ist(start_date, schedule.origin_dep)


def _scheduled_arrival(origin_dep: datetime, stop: Stop) -> datetime | None:
    """Scheduled arrival instant. Offsets are minutes from origin departure and so
    already span midnight; ``day_offset`` is informational and must NOT be added
    again. The origin has no arrival, so its departure stands in for it (a rider
    boarding at the terminus still needs an 'ETA at A')."""
    offset = stop.arr_offset_min if stop.arr_offset_min is not None else stop.dep_offset_min
    if offset is None:
        return None
    return origin_dep + timedelta(minutes=offset)


def _delay_min(actual: datetime, scheduled: datetime) -> int:
    return int(round((actual - scheduled).total_seconds() / 60.0))


def _last_actual(route: list[RouteStop], origin_dep: datetime) -> tuple[datetime, int, int] | None:
    """Find the most recent stop with a recorded actual.
    Returns (actual_time, delay_min, seq) or None."""
    best: tuple[datetime, int, int] | None = None
    for rs in route:
        actual = rs.actual_departure or rs.actual_arrival
        if actual is None:
            continue
        # delay: prefer reported, else derive from actual vs scheduled
        if rs.delay_minutes is not None:
            d = rs.delay_minutes
        elif rs.actual_departure and rs.scheduled_departure:
            d = _delay_min(rs.actual_departure, rs.scheduled_departure)
        elif rs.actual_arrival and rs.scheduled_arrival:
            d = _delay_min(rs.actual_arrival, rs.scheduled_arrival)
        else:
            d = 0
        if best is None or actual > best[0] or (actual == best[0] and rs.seq > best[2]):
            best = (actual, d, rs.seq)
    return best


def _position_from_live(
    live: LiveRun, route: list[RouteStop], origin_dep: datetime, now: datetime
) -> Position:
    """Resolve position state from a live payload (AGENTS.md §6.4)."""
    if live.status.value == "cancelled":
        return Position(kind=PositionKind.CANCELLED)

    loc = live.current_location
    if loc is not None and (loc.station_code or loc.segment_progress is not None):
        # 'at station' heuristic: an actual position with no between-station progress
        if loc.station_code and loc.segment_progress is None:
            return Position(kind=PositionKind.AT_STATION, station_code=loc.station_code)
        if live.previous_halt and live.next_halt:
            # Progress is only reported when upstream asserts a real position.
            # Never invent a value (§11): otherwise None, flagged as estimated.
            real = loc.is_actual_position and loc.segment_progress is not None
            return Position(
                kind=PositionKind.BETWEEN,
                prev_station=live.previous_halt,
                next_station=live.next_halt,
                progress=loc.segment_progress if real else None,
                estimated=not real,
            )
        if loc.station_code:
            return Position(kind=PositionKind.AT_STATION, station_code=loc.station_code)

    # Fall back to the last recorded actual in the route.
    la = _last_actual(route, origin_dep)
    if la is None:
        # No actuals at all: is it before origin departure?
        if now < origin_dep:
            return Position(kind=PositionKind.NOT_STARTED)
        return Position(kind=PositionKind.UNKNOWN)
    last_seq = la[2]
    # next halt after the last actual
    nxt = None
    for rs in route:
        if rs.seq > last_seq:
            nxt = rs
            break
    if nxt is None:
        return Position(kind=PositionKind.TERMINATED)
    return Position(
        kind=PositionKind.BETWEEN,
        prev_station=None,
        next_station=nxt.station_code,
        progress=None,  # no instrumented position: don't fabricate one
        estimated=True,  # derived from timing, not instrumented
    )


def _position_from_timetable(stops: list[StopEta], now: datetime) -> Position:
    """Where the run *should* be per the timetable. Always ``estimated=True``: it is
    a schedule interpolation, never an instrumented position (§6.4)."""
    prev: StopEta | None = None
    for s in stops:
        if s.eta > now:
            if prev is None:
                return Position(kind=PositionKind.NOT_STARTED)
            span = (s.eta - prev.eta).total_seconds()
            progress = (now - prev.eta).total_seconds() / span if span > 0 else None
            return Position(
                kind=PositionKind.BETWEEN,
                prev_station=prev.station_code,
                next_station=s.station_code,
                progress=progress,
                estimated=True,
            )
        prev = s
    return Position(kind=PositionKind.UNKNOWN)


def _route_by_seq(live: LiveRun) -> dict[int, RouteStop]:
    return {rs.seq: rs for rs in live.route}


def _is_stale(live: LiveRun | None, now: datetime, stale_after_seconds: int) -> bool:
    if live is None or live.last_updated_at is None:
        return False
    return age_seconds(live.last_updated_at, now) > stale_after_seconds


def _confidence(source: EtaSource, stale: bool) -> Confidence:
    base = {
        EtaSource.ACTUAL: Confidence.HIGH,
        EtaSource.LIVE_REPORTED: Confidence.HIGH,
        EtaSource.PROPAGATED: Confidence.MEDIUM,
        EtaSource.SCHEDULED: Confidence.LOW,
    }[source]
    if stale:
        return _downgrade(base)
    return base


def _downgrade(c: Confidence) -> Confidence:
    return {
        Confidence.HIGH: Confidence.MEDIUM,
        Confidence.MEDIUM: Confidence.LOW,
        Confidence.LOW: Confidence.LOW,
    }[c]


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #


def compute_run_eta(
    schedule: TrainSchedule,
    live: LiveRun | None,
    now: datetime,
    *,
    start_date: date | None = None,
    stale_after_seconds: int = 300,
    recovery_min_per_segment: float = 0.0,
) -> RunEta:
    """Compute per-stop ETAs + position for a run.

    Pure: depends only on its inputs and ``now``. ``recovery_min_per_segment``
    defaults to 0 (v1) — a late train may be allowed to catch up later.
    """
    now = in_ist(now)
    sdate = start_date or (live.start_date if live else now.date())

    origin_dep = _origin_dep(schedule, sdate)
    if origin_dep is None:
        raise ValueError(f"schedule {schedule.number} has no origin_dep; cannot compute ETAs")

    route_by_seq = _route_by_seq(live) if live else {}
    last_actual = _last_actual(live.route, origin_dep) if live else None
    stale = _is_stale(live, now, stale_after_seconds)

    stops: list[StopEta] = []
    prev_eta: datetime | None = None
    # Baseline delay to carry forward (from the last actual), for propagation.
    baseline_delay = last_actual[1] if last_actual else None
    last_actual_seq = last_actual[2] if last_actual else None
    last_actual_time = last_actual[0] if last_actual else None

    for stop in sorted(schedule.stops, key=lambda s: s.seq):
        sched_arr = _scheduled_arrival(origin_dep, stop)
        if sched_arr is None:
            # Origin stop (no arrival) or malformed — skip from ETA list but keep
            # monotonic bookkeeping.
            continue
        rs = route_by_seq.get(stop.seq)

        source = EtaSource.SCHEDULED
        eta = sched_arr
        delay: int | None = None
        estimated = False

        # The origin has no arrival: its recorded departure is its actual.
        recorded = rs.actual_arrival if rs is not None else None
        if rs is not None and recorded is None and stop.arr_offset_min is None:
            recorded = rs.actual_departure
        if rs is not None and recorded is not None:
            eta = in_ist(recorded)
            source = EtaSource.ACTUAL
        elif rs is not None and rs.delay_minutes is not None:
            eta = sched_arr + timedelta(minutes=rs.delay_minutes)
            source = EtaSource.LIVE_REPORTED
            delay = rs.delay_minutes
        elif (
            baseline_delay is not None
            and last_actual_seq is not None
            and stop.seq > last_actual_seq
        ):
            # Propagate: carry the last known delay forward, allowing recovery.
            # Applies even when upstream's route[] has no row for this stop.
            segs = stop.seq - last_actual_seq
            recovered = min(recovery_min_per_segment * segs, max(0.0, baseline_delay))
            eff = baseline_delay - recovered
            eta = sched_arr + timedelta(minutes=eff)
            source = EtaSource.PROPAGATED
            delay = int(round(eff))
            estimated = True

        # Constraint 1: never precede the last recorded actual time.
        if (
            source is not EtaSource.ACTUAL
            and last_actual_time is not None
            and last_actual_seq is not None
            and stop.seq > last_actual_seq
            and eta < last_actual_time
        ):
            eta = last_actual_time
            if source is EtaSource.SCHEDULED:
                source = EtaSource.PROPAGATED
                estimated = True

        # Constraint 2: monotonic non-decreasing across stops.
        if prev_eta is not None and eta < prev_eta:
            eta = prev_eta
            if source is EtaSource.SCHEDULED:
                source = EtaSource.PROPAGATED
                estimated = True
        prev_eta = eta

        # Recompute displayed delay now that eta may have been clamped.
        delay = int(round((eta - sched_arr).total_seconds() / 60.0))

        stops.append(
            StopEta(
                seq=stop.seq,
                station_code=stop.station_code,
                eta=eta,
                eta_source=source,
                delay_min=delay,
                confidence=_confidence(source, stale),
                state=_state_for(stop.seq, eta, now, rs),
                stale=stale,
                estimated=estimated,
                scheduled=sched_arr,
                platform=rs.platform if rs is not None else None,
            )
        )

    # Position + data mode.
    if live is None:
        if now < origin_dep:
            position = Position(kind=PositionKind.NOT_STARTED)
        elif stops and now > stops[-1].eta:
            position = Position(kind=PositionKind.TERMINATED)
        else:
            position = _position_from_timetable(stops, now)
        data_mode = DataMode.SCHEDULED
    else:
        if live.status.value == "cancelled":
            position = Position(kind=PositionKind.CANCELLED)
            data_mode = DataMode.SCHEDULED
        else:
            position = _position_from_live(live, live.route, origin_dep, now)
            data_mode = _data_mode(live, now, stale_after_seconds, stops)

    return RunEta(
        number=schedule.number,
        start_date=sdate,
        computed_at=now,
        data_mode=data_mode,
        position=position,
        stops=tuple(stops),
        stale_seconds=age_seconds(live.last_updated_at, now)
        if (live and live.last_updated_at)
        else None,
        exceptions=tuple(live.exceptions) if live else (),
    )


def _state_for(seq: int, eta: datetime, now: datetime, rs: RouteStop | None) -> str:
    # A stop that upstream already marked skipped/terminated.
    if rs is not None and rs.status and rs.status.lower() in {"skipped", "no-halt", "terminated"}:
        return STATE_SKIPPED
    # Has it already happened (an actual is recorded)?
    if rs is not None and (rs.actual_arrival is not None or rs.actual_departure is not None):
        return STATE_DEPARTED if (rs.actual_departure is not None or now > eta) else STATE_ARRIVING
    delta_min = (eta - now).total_seconds() / 60.0
    if delta_min < -ARRIVING_WINDOW_MIN:
        return STATE_DEPARTED
    if delta_min <= ARRIVING_WINDOW_MIN:
        return STATE_ARRIVING
    return STATE_UPCOMING


def _data_mode(
    live: LiveRun, now: datetime, stale_after_seconds: int, stops: list[StopEta]
) -> DataMode:
    if not live.is_live:
        return DataMode.SCHEDULED
    if not stops:
        return DataMode.SCHEDULED
    reported = [s for s in stops if s.eta_source in (EtaSource.ACTUAL, EtaSource.LIVE_REPORTED)]
    if reported and not _is_stale(live, now, stale_after_seconds):
        if len(reported) == len(stops):
            return DataMode.LIVE
        return DataMode.PARTIAL
    return DataMode.PARTIAL


# --------------------------------------------------------------------------- #
# A -> B journey
# --------------------------------------------------------------------------- #


def journey_between(
    schedule: TrainSchedule,
    run: RunEta,
    from_code: str,
    to_code: str,
    *,
    now: datetime | None = None,
) -> JourneyResult | None:
    """Build the A→B result for one train, or ``None`` if this train doesn't
    serve A→B (A or B not a halt, or wrong direction) (AGENTS.md §2, §6.4).

    Only trains that HALT at both A and B, with A before B in the run's
    direction, are eligible.
    """
    a = run.stop(from_code)
    b = run.stop(to_code)
    if a is None or b is None:
        return None  # A or B is not a halt on this run.
    if a.seq >= b.seq:
        return None  # wrong direction (A must come before B).

    now = in_ist(now or run.computed_at)

    # State relative to A (AGENTS.md §6.4: upcoming | arriving | at_station |
    # already_departed).
    delta_a = (a.eta - now).total_seconds()
    if a.eta_source is EtaSource.ACTUAL and a.state in (STATE_DEPARTED, STATE_AT_STATION):
        state_a = a.state
    elif delta_a < 0:
        state_a = STATE_DEPARTED if delta_a < -ARRIVING_WINDOW_MIN * 60 else STATE_AT_STATION
    else:
        state_a = STATE_ARRIVING if delta_a <= ARRIVING_WINDOW_MIN * 60 else STATE_UPCOMING

    return JourneyResult(
        number=run.number,
        name=schedule.name,
        eta_at_a=a.eta,
        eta_at_b=b.eta,
        expected_ride_min=int(round((b.eta - a.eta).total_seconds() / 60.0)),
        delay_at_a=a.delay_min,
        state_relative_to_a=state_a,
        platform_at_a=a.platform,
        source_at_a=a.eta_source,
        source_at_b=b.eta_source,
        data_mode=run.data_mode,
    )
