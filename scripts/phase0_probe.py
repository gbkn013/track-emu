"""Phase 0 probe (AGENTS.md §4). Manual only — spends real RailRadar quota.

Every call is appended to data/quota_ledger.jsonl and the total is capped at
PHASE0_BUDGET (150) *across all runs*, counted from the ledger itself.
The API key is read from .env / the environment and never printed or saved.

Usage (from repo root):
  uv run python scripts/phase0_probe.py status
  uv run python scripts/phase0_probe.py catalogue            # steps 1-2 (2 calls)
  uv run python scripts/phase0_probe.py live 43501 40567 ... # step 3 (1 call/train)
  uv run python scripts/phase0_probe.py board MSB TBM CGL MAS # step 4 (1 call/station)

Responses are saved to tests/fixtures/railradar/ as the raw envelope.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
LEDGER = ROOT / "data" / "quota_ledger.jsonl"
FIXTURES = ROOT / "tests" / "fixtures" / "railradar"
BASE = "https://api.railradar.in/v1"
PHASE0_BUDGET = 150
IST = timezone(timedelta(hours=5, minutes=30))
# Response headers worth keeping (quota discovery, §4 step 7). Nothing else is stored.
KEEP_HEADERS = ("retry-after", "x-ratelimit", "ratelimit", "x-request-id")


def load_key() -> str:
    key = os.environ.get("RAILRADAR_API_KEY", "")
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("RAILRADAR_API_KEY="):
                key = line.split("=", 1)[1].strip().strip("'\"")
    if not key:
        sys.exit("RAILRADAR_API_KEY not set (put it in .env). Nothing was sent.")
    return key


def calls_used() -> int:
    return sum(1 for _ in LEDGER.open()) if LEDGER.exists() else 0


def fetch(client: httpx.Client, path: str, fixture: str, params: dict | None = None) -> dict | None:
    if calls_used() >= PHASE0_BUDGET:
        sys.exit(f"Phase 0 budget of {PHASE0_BUDGET} calls exhausted. Stop and write findings.")
    t0 = time.monotonic()
    status, body, hdrs = 0, None, {}
    try:
        r = client.get(f"{BASE}{path}", params=params)
        status = r.status_code
        hdrs = {k: v for k, v in r.headers.items() if k.lower().startswith(KEEP_HEADERS)}
        body = r.json() if r.content else None
    except (httpx.HTTPError, ValueError) as e:
        body = {"_error": type(e).__name__}
    ms = int((time.monotonic() - t0) * 1000)
    now = datetime.now(IST)
    LEDGER.parent.mkdir(exist_ok=True)
    with LEDGER.open("a") as f:
        f.write(
            json.dumps({"ts": now.isoformat(), "endpoint": path, "status": status, "ms": ms}) + "\n"
        )
    FIXTURES.mkdir(parents=True, exist_ok=True)
    out = {"_recorded_at": now.isoformat(), "_status": status, "_headers": hdrs, "body": body}
    (FIXTURES / fixture).write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"{status} {path} {ms}ms -> {fixture}  [{calls_used()}/{PHASE0_BUDGET} used]")
    return body if status == 200 else None


def main(argv: list[str]) -> None:
    cmd = argv[1] if len(argv) > 1 else "status"
    if cmd == "status":
        print(f"{calls_used()}/{PHASE0_BUDGET} Phase 0 calls used")
        return
    stamp = datetime.now(IST).strftime("%Y%m%dT%H%M")
    with httpx.Client(headers={"Authorization": f"Bearer {load_key()}"}, timeout=30) as c:
        if cmd == "catalogue":
            fetch(
                c, "/lookup/trains/local", "01_get_chennai-local-trains.json", {"city": "Chennai"}
            )
            fetch(c, "/lookup/stations", "02_get_stations.json")
        elif cmd == "live":
            for n in argv[2:]:
                fetch(c, f"/trains/{n}/live", f"03_get_live_{n}_{stamp}.json")
        elif cmd == "board":
            for code in argv[2:]:
                fetch(
                    c, f"/stations/{code}/live", f"04_get_board_{code}_{stamp}.json", {"hours": 2}
                )
        else:
            sys.exit(f"unknown command {cmd!r}")


if __name__ == "__main__":
    main(sys.argv)
