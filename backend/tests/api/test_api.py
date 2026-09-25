from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from ...app.api.main import create_app
from ...app.core.config import Settings
from ..fakes import FakeStatic


@pytest.fixture
def client(tmp_path):
    s = Settings(
        **dict(Settings.load().__dict__, ledger_path=tmp_path / "l.jsonl", live_source="none")
    )
    with TestClient(create_app(s, static=FakeStatic())) as c:
        yield c


def test_journeys_shape_and_freshness_fields(client):
    r = client.get(
        "/api/v1/journeys",
        params={"from": "MSB", "to": "TBM", "after": "2026-09-21T05:00:00+05:30"},
    )
    assert r.status_code == 200
    b = r.json()
    for k in ("data_mode", "fetched_at", "source", "stale_seconds", "journeys"):
        assert k in b
    assert b["journeys"][0]["eta_at_a"].endswith("+05:30")


@pytest.mark.parametrize(
    "path,status,code",
    [
        ("/api/v1/trains/abc", 422, "bad_train_number"),
        ("/api/v1/trains/99999", 404, "train_not_found"),
        ("/api/v1/journeys?from=MSB&to=MSB", 422, "same_station"),
        ("/api/v1/journeys?from=MSB&to=NOPE", 404, "station_not_found"),
        ("/api/v1/journeys?from=MSB&to=TBM&after=yesterday", 422, "bad_time"),
        ("/api/v1/stations/TBM/board?hours=3", 422, "bad_hours"),
    ],
)
def test_single_error_shape(client, path, status, code):
    r = client.get(path)
    assert r.status_code == status
    e = r.json()["error"]
    assert e["code"] == code and e["traceId"] and e["message"]


def test_health_and_status_and_train_endpoints(client):
    assert client.get("/healthz").json() == {"ok": True}
    st = client.get("/api/v1/meta/status").json()
    assert st["live_source"] == "none" and st["trains"] == 4
    t = client.get("/api/v1/trains/40001").json()
    assert [s["station_code"] for s in t["stops"]] == ["MSB", "TBM", "CGL"]
    assert client.get("/api/v1/trains/40001/live").json()["data_mode"] == "scheduled"
    assert client.get("/api/v1/trains/40001/route").json()["type"] == "LineString"
    assert client.get("/api/v1/stations?q=tb").json()["stations"][0]["code"] == "TBM"


def test_stops_carry_coordinate_keys_for_the_map(client):
    stop = client.get("/api/v1/trains/40001/live").json()["stops"][0]
    assert "lat" in stop and "lng" in stop


def test_runtime_config_exposes_tile_url_only(client):
    cfg = client.get("/api/v1/meta/config").json()
    assert cfg == {"tile_source_url": None}  # no secrets (e.g. API key) ever exposed here
