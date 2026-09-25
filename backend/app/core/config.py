"""Environment-driven settings (AGENTS.md §10). No secrets are logged."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _load_dotenv() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))


@dataclass(frozen=True)
class Settings:
    railradar_api_key: str
    #: Timetable source: datameet (free CC0 snapshot, offline).
    static_source: str
    #: Live source: none | railradar (spends quota).
    live_source: str
    monthly_request_budget: int
    poll_mode: str
    station_board_ttl_s: int
    train_live_ttl_s: int
    stale_after_seconds: int
    max_stale_seconds: int
    live_overlay_max: int
    ledger_path: Path
    tile_source_url: str
    log_level: str

    @classmethod
    def load(cls) -> Settings:
        _load_dotenv()
        e = os.environ.get
        return cls(
            railradar_api_key=e("RAILRADAR_API_KEY", ""),
            static_source=e("STATIC_SOURCE", "datameet"),
            live_source=e("LIVE_SOURCE", "none"),
            monthly_request_budget=int(e("MONTHLY_REQUEST_BUDGET", "1000")),
            poll_mode=e("POLL_MODE", "on_demand"),
            station_board_ttl_s=int(e("STATION_BOARD_TTL_S", "75")),
            train_live_ttl_s=int(e("TRAIN_LIVE_TTL_S", "50")),
            stale_after_seconds=int(e("STALE_AFTER_SECONDS", "300")),
            max_stale_seconds=int(e("MAX_STALE_SECONDS", "1800")),
            live_overlay_max=int(e("LIVE_OVERLAY_MAX", "4")),
            ledger_path=Path(e("LEDGER_PATH", str(ROOT / "data" / "quota_ledger.jsonl"))),
            tile_source_url=e("TILE_SOURCE_URL", ""),
            log_level=e("LOG_LEVEL", "INFO"),
        )
