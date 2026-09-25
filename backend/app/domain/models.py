"""Domain model (AGENTS.md §6.2).

These are the *app's own* types. Providers map their vendor JSON into these in
one place per provider (§6.1). All models tolerate missing/extra fields — we log
schema drift rather than crash (§6.1). All datetimes are timezone-aware IST.

Design notes
------------
- ``schedule_stops`` are expressed as *offsets from the origin departure* so one
  base timetable can be applied to any journey date (§6.2). The origin stop
  carries ``dep_offset_min = 0``.
- A *run* is keyed by ``(number, start_date)`` — the date the train started its
  service, NOT the calendar date a given stop is reached (midnight rollover, §2).
- ``LiveRun`` mirrors the fields of interest from RailRadar ``/trains/{n}/live``
  (§3.1) in provider-neutral terms.
"""

from __future__ import annotations

from datetime import date, datetime, time
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..core.timeutil import in_ist

# --------------------------------------------------------------------------- #
# Enumerations
# --------------------------------------------------------------------------- #


class TrainKind(StrEnum):
    EMU = "EMU"
    MEMU = "MEMU"
    MRTS = "MRTS"
    OTHER = "OTHER"


class RunStatus(StrEnum):
    SCHEDULED = "scheduled"
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    PARTIALLY_CANCELLED = "partially_cancelled"
    DIVERTED = "diverted"


class PositionKind(StrEnum):
    """Where a run currently is (AGENTS.md §6.4)."""

    NOT_STARTED = "not_started"
    AT_STATION = "at_station"
    BETWEEN = "between"
    TERMINATED = "terminated"
    CANCELLED = "cancelled"
    UNKNOWN = "unknown"


class EtaSource(StrEnum):
    """Provenance of a per-stop ETA (AGENTS.md §6.4) — never upgrade to look live."""

    ACTUAL = "actual"
    LIVE_REPORTED = "live_reported"
    PROPAGATED = "propagated"
    SCHEDULED = "scheduled"


class DataMode(StrEnum):
    """Overall freshness of a response (AGENTS.md §6.5)."""

    LIVE = "live"
    PARTIAL = "partial"
    SCHEDULED = "scheduled"


class Confidence(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


# --------------------------------------------------------------------------- #
# Base
# --------------------------------------------------------------------------- #


class Tolerant(BaseModel):
    """Pydantic base that tolerates missing/extra fields and keeps raw input for
    drift logging instead of raising (§6.1)."""

    model_config = ConfigDict(extra="allow", validate_assignment=True)

    @classmethod
    def tolerant_from(cls, data: Any) -> Tolerant:
        """Best-effort construction: on validation failure, return a minimal
        instance with the raw payload stashed in ``__raw`` and a drift marker set,
        rather than raising. Callers decide whether a drift is fatal."""
        try:
            return cls.model_validate(data)
        except Exception:  # noqa: BLE001 - deliberate: log drift, don't crash
            return cls.model_construct(
                **(data if isinstance(data, dict) else {}), __raw=data, __drift=True
            )

    def drift(self) -> bool:
        return bool(self.__dict__.get("__drift", False))


# --------------------------------------------------------------------------- #
# Catalogue / static
# --------------------------------------------------------------------------- #


class Station(Tolerant):
    code: str
    name: str
    lat: float | None = None
    lng: float | None = None
    zone: str | None = None
    is_suburban: bool = False
    name_ta: str | None = None  # i18n-ready (AGENTS.md §7)


class TrainRef(Tolerant):
    """A lightweight reference — number + name — as returned by
    ``list_local_trains``."""

    number: str
    name: str


class Stop(Tolerant):
    """One halt in a base timetable, as an offset from the origin departure."""

    seq: int
    station_code: str
    station_name: str | None = None
    #: Minutes after origin departure at which the train is scheduled to arrive.
    #: ``None`` for the origin stop (arrives at 0 / is the origin).
    arr_offset_min: int | None = None
    #: Minutes after origin departure at which the train is scheduled to depart.
    #: ``None`` for the final stop (does not depart).
    dep_offset_min: int | None = Field(default=None)
    #: 0 or 1 — 1 when the scheduled time has rolled past midnight (§2).
    day_offset: int = 0
    is_halt: bool = True
    distance_km: float | None = None


class Train(Tolerant):
    number: str
    name: str
    kind: TrainKind = TrainKind.OTHER
    source: str | None = None
    destination: str | None = None
    #: Weekdays this train runs, 0=Mon .. 6=Sun (run-day mask, §2).
    run_days: list[int] = Field(default_factory=list)
    updated_at: datetime | None = None

    @field_validator("updated_at", mode="before")
    @classmethod
    def _fix_updated_at(cls, v: datetime | None) -> datetime | None:
        return in_ist(v) if v is not None else None


class TrainSchedule(Tolerant):
    """A full static schedule for one train (all halts, whole run)."""

    number: str
    name: str
    kind: TrainKind = TrainKind.OTHER
    source: str | None = None
    destination: str | None = None
    #: Origin departure time-of-day from the base timetable (e.g. 05:30).
    origin_dep: time | None = None
    run_days: list[int] = Field(default_factory=list)
    stops: list[Stop] = Field(default_factory=list)
    updated_at: datetime | None = None


# --------------------------------------------------------------------------- #
# Live
# --------------------------------------------------------------------------- #


class CurrentLocation(Tolerant):
    station_code: str | None = None
    status: str | None = None
    #: True only when upstream asserts this is a real GPS/instrumented position.
    is_actual_position: bool = False
    #: 0..1 progress along the current segment (only meaningful if is_actual_position).
    segment_progress: float | None = None
    speed_kmh: float | None = None
    bearing_degrees: float | None = None


class RouteStop(Tolerant):
    """Per-stop live row from ``/trains/{n}/live`` ``route[]``."""

    seq: int
    station_code: str
    station_name: str | None = None
    status: str | None = None
    #: Scheduled arrival/departure (absolute, aware).
    scheduled_arrival: datetime | None = None
    scheduled_departure: datetime | None = None
    #: Recorded actuals (absolute, aware) — None if not yet happened / not reported.
    actual_arrival: datetime | None = None
    actual_departure: datetime | None = None
    #: Upstream-reported delay in minutes at this stop (None if not reported).
    delay_minutes: int | None = None
    platform: int | None = None


class RunException(Tolerant):
    """One entry of the live payload's ``exceptions[]`` (DIVERTED / partial cancel
    / rescheduled, §2)."""

    type: str
    payload: dict[str, Any] = Field(default_factory=dict)


class LiveRun(Tolerant):
    """Provider-neutral live status for one run (number, start_date)."""

    number: str
    start_date: date
    status: RunStatus = RunStatus.RUNNING
    #: Whether upstream considers this genuinely live (vs a schedule echo).
    is_live: bool = False
    last_updated_at: datetime | None = None
    delay_minutes: int | None = None
    current_location: CurrentLocation | None = None
    previous_halt: str | None = None
    next_halt: str | None = None
    route: list[RouteStop] = Field(default_factory=list)
    exceptions: list[RunException] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Station board
# --------------------------------------------------------------------------- #


class BoardEntry(Tolerant):
    """One train on a station board (``/stations/{code}/live``)."""

    train_number: str
    train_name: str | None = None
    #: at-station | upcoming | departed | scheduled
    live_type: str
    expected_departure_time: datetime | None = None
    delay_minutes: int | None = None
    platform: int | None = None
    direction: str | None = None


class StationBoard(Tolerant):
    code: str
    station_name: str | None = None
    #: The [window_start, window_end] the board covers.
    window_start: datetime | None = None
    window_end: datetime | None = None
    entries: list[BoardEntry] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #


class GeoJSONLine(Tolerant):
    """A GeoJSON LineString for the map (``/trains/{n}/route``)."""

    type: str = "LineString"
    coordinates: list[list[float]] = Field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, "coordinates": self.coordinates}
