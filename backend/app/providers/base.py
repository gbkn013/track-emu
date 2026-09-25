"""Provider interface (AGENTS.md §6.1) — the mandatory abstraction.

The rest of the app never sees a vendor's JSON. Every provider implements
:class:`RailDataProvider` and maps upstream fields into domain types in ONE place,
tolerating missing/extra fields and logging schema drift rather than crashing.

Implementations:
- :class:`~app.providers.railradar.RailRadarProvider` — primary (live, spends quota).
- :class:`~app.providers.replay.ReplayProvider` — serves recorded fixtures; ALL dev
  and CI runs use this. CI must never hit the network.
- NtesProvider — stub, disabled by default (AGENTS.md §3.2).
"""

from __future__ import annotations

import abc
from datetime import date
from typing import Any

from ..domain.models import (
    GeoJSONLine,
    LiveRun,
    Station,
    StationBoard,
    TrainRef,
    TrainSchedule,
)


class ProviderError(RuntimeError):
    """A provider-level failure (network, auth, bad payload). Carries ``code`` so
    callers can map to the app's single error shape (§6.5)."""

    def __init__(self, message: str, *, code: str = "provider_error", status: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status


class NoLiveData(ProviderError):
    """This provider has no live data (static timetable source)."""

    def __init__(self, message: str = "provider has no live data"):
        super().__init__(message, code="no_live_data")


class QuotaExceeded(ProviderError):
    """Upstream quota/rate limit (HTTP 429). Callers must degrade, not retry-hot."""

    def __init__(self, message: str = "quota exceeded", *, retry_after_s: int | None = None):
        super().__init__(message, code="quota_exceeded", status=429)
        self.retry_after_s = retry_after_s


class UpstreamDegraded(ProviderError):
    """HTTP 503 — 'upstream transit telemetry provider temporarily degraded' (§3.1).
    Transient: back off and retry."""

    def __init__(self, message: str = "upstream degraded", *, retry_after_s: int | None = None):
        super().__init__(message, code="upstream_degraded", status=503)
        self.retry_after_s = retry_after_s


class RailDataProvider(abc.ABC):
    """Provider-neutral rail data access (AGENTS.md §6.1)."""

    #: Stable provider id, used in responses' ``source`` field and the ledger.
    name: str = "base"
    #: False for static-only sources (e.g. datameet): live/board calls raise NoLiveData.
    supports_live: bool = True

    @abc.abstractmethod
    async def list_local_trains(self, city: str) -> list[TrainRef]:
        """Enumerate local (EMU/MEMU/MRTS) trains for a city. Never hard-code
        number ranges — enumerate from here (§2, §4 step 1)."""

    @abc.abstractmethod
    async def get_schedule(self, train_no: str) -> TrainSchedule:
        """Static schedule: stops, halts, run days (whole run, §3.1)."""

    @abc.abstractmethod
    async def get_live_run(self, train_no: str, start_date: date | None = None) -> LiveRun:
        """Live status for one run. ``start_date`` None ⇒ today's run (provider-local)."""

    @abc.abstractmethod
    async def get_station_board(self, code: str, hours_ahead: int = 2) -> StationBoard:
        """Live station board: every train in [now-4h, now+hours_ahead] (§3.1)."""

    @abc.abstractmethod
    async def get_route_geometry(self, train_no: str) -> GeoJSONLine:
        """GeoJSON/polyline track geometry for the map."""

    @abc.abstractmethod
    async def list_stations(self) -> list[Station]:
        """Station directory (with coordinates). Get codes from here, never memory (§2)."""

    # -- helpers ----------------------------------------------------------- #

    def describe(self) -> dict[str, Any]:
        """Small self-description for ``/meta/status``."""
        return {"name": self.name}
