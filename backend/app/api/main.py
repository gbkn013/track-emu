"""FastAPI app (AGENTS.md §6.5). Single error shape; validated inputs."""

from __future__ import annotations

import logging
import re
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime
from pathlib import Path

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from ..core.config import Settings
from ..core.timeutil import in_ist, utcnow
from ..providers.base import ProviderError, RailDataProvider
from ..providers.datameet import DatameetProvider
from ..providers.railradar import RailRadarProvider
from ..services.queries import Catalogue, QueryService
from ..services.quota import QuotaLedger

TRAIN_RE = re.compile(r"^\d{5}$")
CODE_RE = re.compile(r"^[A-Z0-9]{1,6}$")
FRONTEND_DIST = Path(__file__).resolve().parents[3] / "frontend" / "dist"


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        self.status, self.code, self.message = status, code, message


def create_app(
    settings: Settings | None = None,
    *,
    static: RailDataProvider | None = None,
    live: RailDataProvider | None = None,
) -> FastAPI:
    settings = settings or Settings.load()
    logging.basicConfig(level=settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        ledger = QuotaLedger(settings.ledger_path, settings.monthly_request_budget)
        st = static or DatameetProvider()
        lv = live
        if lv is None and settings.live_source == "railradar":
            lv = RailRadarProvider(settings.railradar_api_key, ledger=ledger.record)
        cat = await Catalogue.load(st)
        app.state.svc = QueryService(settings, cat, st, lv, ledger)
        yield

    app = FastAPI(title="TN Rail Tracker", lifespan=lifespan)

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, e: ApiError):
        return _err(e.status, e.code, e.message)

    @app.exception_handler(ProviderError)
    async def _prov_error(request: Request, e: ProviderError):
        return _err(502, e.code, str(e))

    def _err(status: int, code: str, message: str) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": code, "message": message, "traceId": uuid.uuid4().hex[:12]}},
            status_code=status,
        )

    def svc(request: Request) -> QueryService:
        return request.app.state.svc

    def _train(request: Request, number: str) -> str:
        if not TRAIN_RE.match(number):
            raise ApiError(422, "bad_train_number", "train number must be 5 digits")
        if number not in svc(request).cat.schedules:
            raise ApiError(404, "train_not_found", f"unknown train {number}")
        return number

    def _station(request: Request, code: str) -> str:
        code = code.upper()
        if not CODE_RE.match(code):
            raise ApiError(422, "bad_station_code", "invalid station code")
        if code not in svc(request).cat.by_station:
            raise ApiError(404, "station_not_found", f"unknown station {code}")
        return code

    def _now(after: str) -> datetime:
        if after == "now":
            return utcnow()
        try:
            return in_ist(datetime.fromisoformat(after))
        except ValueError:
            raise ApiError(422, "bad_time", "after must be 'now' or ISO-8601") from None

    @app.get("/healthz")
    async def healthz():
        return {"ok": True}

    @app.get("/api/v1/stations")
    async def stations(request: Request, q: str = ""):
        return {"stations": svc(request).search_stations(q)}

    @app.get("/api/v1/stations/{code}/board")
    async def board(request: Request, code: str, hours: int = Query(2)):
        if hours not in (2, 4, 6, 8):
            raise ApiError(422, "bad_hours", "hours must be 2, 4, 6 or 8")
        return await svc(request).board(_station(request, code), utcnow(), hours)

    @app.get("/api/v1/journeys")
    async def journeys(
        request: Request,
        from_: str = Query(alias="from"),
        to: str = "",
        after: str = "now",
        limit: int = Query(10, ge=1, le=50),
        show_departed: bool = False,
    ):
        a, b = _station(request, from_), _station(request, to)
        if a == b:
            raise ApiError(422, "same_station", "from and to must differ")
        return await svc(request).journeys(
            a, b, _now(after), limit=limit, show_departed=show_departed
        )

    @app.get("/api/v1/trains")
    async def trains(request: Request, q: str = ""):
        return {"trains": svc(request).search_trains(q)}

    @app.get("/api/v1/trains/{number}")
    async def train(request: Request, number: str):
        s = svc(request)
        return s.train_schedule_json(s.cat.schedules[_train(request, number)])

    @app.get("/api/v1/trains/{number}/live")
    async def train_live(
        request: Request, number: str, date_: date | None = Query(None, alias="date")
    ):
        return await svc(request).train_live(_train(request, number), utcnow(), date_)

    @app.get("/api/v1/trains/{number}/route")
    async def train_route(request: Request, number: str):
        return await svc(request).route_geometry(_train(request, number))

    @app.get("/api/v1/meta/config")
    async def meta_config():
        # Runtime config for the SPA (keeps TILE_SOURCE_URL server-side, per §10).
        return {"tile_source_url": settings.tile_source_url or None}

    @app.get("/api/v1/meta/status")
    async def meta_status(request: Request):
        return svc(request).status()

    if FRONTEND_DIST.exists():
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="web")
    return app
