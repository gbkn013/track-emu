"""Static timetable provider backed by the committed datameet extract (CC0).

Free, offline, no quota. Schedule-only: it has NO live data and NO run-day masks
(trains are assumed to run daily — the API labels this). The snapshot is ~2016 so
timetables and train numbers may be outdated; see docs/data-source-findings.md.
"""

from __future__ import annotations

import json
from datetime import date, time
from pathlib import Path

from ..domain.models import (
    GeoJSONLine,
    LiveRun,
    Station,
    StationBoard,
    Stop,
    TrainKind,
    TrainRef,
    TrainSchedule,
)
from .base import NoLiveData, ProviderError, RailDataProvider

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "datameet_tn.json"


class DatameetProvider(RailDataProvider):
    name = "datameet"
    supports_live = False

    def __init__(self, path: Path = DATA_FILE) -> None:
        raw = json.loads(path.read_text())
        self.source_note: str = raw["source"]
        self._stations = {s["code"]: s for s in raw["stations"]}
        self._trains = {t["number"]: t for t in raw["trains"]}

    async def list_local_trains(self, city: str) -> list[TrainRef]:
        # The extract is Tamil Nadu-wide; `city` is accepted for interface parity.
        return [TrainRef(number=t["number"], name=t["name"]) for t in self._trains.values()]

    async def get_schedule(self, train_no: str) -> TrainSchedule:
        t = self._trains.get(train_no)
        if t is None:
            raise ProviderError(f"unknown train {train_no}", code="not_found", status=404)
        stops = []
        for i, s in enumerate(t["stops"]):
            arr, dep = s["arr"], s["dep"]
            stops.append(
                Stop(
                    seq=i,
                    station_code=s["code"],
                    station_name=self._stations.get(s["code"], {}).get("name"),
                    arr_offset_min=arr,
                    dep_offset_min=dep,
                    day_offset=((arr if arr is not None else dep or 0) + t["origin_dep_min"])
                    // 1440,
                )
            )
        o = t["origin_dep_min"] % 1440
        return TrainSchedule(
            number=t["number"],
            name=t["name"],
            kind=TrainKind(t["kind"]),
            source=t["stops"][0]["code"],
            destination=t["stops"][-1]["code"],
            origin_dep=time(o // 60, o % 60),
            run_days=[],  # unknown in this dataset (assumed daily by the app)
            stops=stops,
        )

    async def get_live_run(self, train_no: str, start_date: date | None = None) -> LiveRun:
        raise NoLiveData

    async def get_station_board(self, code: str, hours_ahead: int = 2) -> StationBoard:
        raise NoLiveData

    async def get_route_geometry(self, train_no: str) -> GeoJSONLine:
        """Straight polyline through station coordinates (no track geometry here)."""
        t = self._trains.get(train_no)
        if t is None:
            raise ProviderError(f"unknown train {train_no}", code="not_found", status=404)
        coords = []
        for s in t["stops"]:
            st = self._stations.get(s["code"])
            if st and st["lat"] is not None:
                coords.append([st["lng"], st["lat"]])
        return GeoJSONLine(coordinates=coords)

    async def list_stations(self) -> list[Station]:
        return [
            Station(
                code=s["code"],
                name=s["name"],
                lat=s["lat"],
                lng=s["lng"],
                zone=s["zone"],
                is_suburban=True,
            )
            for s in self._stations.values()
        ]
