"""Offline fake providers for service/API tests (no network, ever)."""

from __future__ import annotations

from datetime import date, time

from ..app.domain.models import (
    GeoJSONLine,
    LiveRun,
    RouteStop,
    Station,
    StationBoard,
    TrainKind,
    TrainRef,
    TrainSchedule,
)
from ..app.providers.base import NoLiveData, ProviderError, QuotaExceeded, RailDataProvider
from .eta.helpers import make_schedule


def schedules() -> list[TrainSchedule]:
    return [
        # Fast: MSB 05:30 -> TBM(+50) -> CGL(+100)
        make_schedule(
            [("MSB", None, 0, 0), ("TBM", 50, 51, 0), ("CGL", 100, None, 0)],
            number="40001",
            origin_dep=time(5, 30),
        ),
        # Reverse direction: CGL 06:00 -> TBM -> MSB (wrong direction for MSB->TBM)
        make_schedule(
            [("CGL", None, 0, 0), ("TBM", 50, 51, 0), ("MSB", 100, None, 0)],
            number="40002",
            origin_dep=time(6, 0),
        ),
        # Skips TBM
        make_schedule(
            [("MSB", None, 0, 0), ("CGL", 80, None, 0)], number="40003", origin_dep=time(5, 40)
        ),
        # Midnight crosser: MAS 23:40 -> TRT 00:25 (+45)
        make_schedule(
            [("MAS", None, 0, 0), ("TRT", 45, None, 1)],
            number="43501",
            origin_dep=time(23, 40),
            kind=TrainKind.MEMU,
        ),
    ]


class FakeStatic(RailDataProvider):
    name = "fake-static"
    supports_live = False

    async def list_local_trains(self, city):
        return [TrainRef(number=s.number, name=s.name) for s in schedules()]

    async def get_schedule(self, n):
        for s in schedules():
            if s.number == n:
                return s
        raise ProviderError("nf", code="not_found")

    async def get_live_run(self, n, d=None):
        raise NoLiveData

    async def get_station_board(self, c, h=2):
        raise NoLiveData

    async def get_route_geometry(self, n):
        return GeoJSONLine(coordinates=[[80.0, 13.0]])

    async def list_stations(self):
        return [Station(code=c, name=c) for c in ("MSB", "TBM", "CGL", "MAS", "TRT")]


class FakeLive(FakeStatic):
    """Live source: 40001 is 12 min late at MSB (actual dep)."""

    name = "fake-live"
    supports_live = True

    def __init__(self, fail: Exception | None = None):
        self.calls = 0
        self.fail = fail

    async def get_live_run(self, n, d=None):
        self.calls += 1
        if self.fail:
            raise self.fail
        from datetime import datetime

        from ..app.core.timeutil import IST

        dd = d or date(2026, 9, 21)
        base = datetime.combine(dd, time(5, 30), IST)
        from datetime import timedelta

        return LiveRun(
            number=n,
            start_date=dd,
            is_live=True,
            last_updated_at=base + timedelta(minutes=13),
            route=[
                RouteStop(
                    seq=0,
                    station_code="MSB",
                    scheduled_departure=base,
                    actual_departure=base + timedelta(minutes=12),
                    delay_minutes=12,
                )
            ],
        )

    async def get_station_board(self, c, h=2):
        from ..app.domain.models import BoardEntry

        return StationBoard(
            code=c,
            entries=[
                BoardEntry(train_number="40001", live_type="upcoming", delay_minutes=7, platform=3)
            ],
        )


def quota_exceeded() -> QuotaExceeded:
    return QuotaExceeded(retry_after_s=60)
