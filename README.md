# TN Rail Tracker

Unofficial EMU/MEMU tracker for Tamil Nadu (Chennai Suburban first): pick **A → B**, see every direct train with ETA at
both ends, open a train for its stop timeline and map, or browse a station board. Installable PWA.
**Informational only — not affiliated with Indian Railways.** See `AGENTS.md` for the full spec.

## What works today (honestly)
- **Timetable mode (default, free, offline):** 130 Tamil Nadu EMU/MEMU trains from the CC0 datameet dataset (~2016).
  Every ETA is labelled *Scheduled*. No live data is claimed. Run days are unknown (assumed daily).
- **Live overlay (opt-in):** set `LIVE_SOURCE=railradar` + `RAILRADAR_API_KEY`. Delays are then shown as
  *Live* (recorded/reported) or *Estimated* (last delay carried forward). **The RailRadar mapping is unverified**
  against real responses — run Phase 0 first (`docs/data-source-findings.md`).
- Quota-aware and board-first: one shared station-board call per station per 75 s covers all trains (≈ 48 calls/hour while a page is open ⇒ ~20 h/month on the free tier — an estimate). Budget guard, single-flight cache, circuit breaker, stale-serving, graceful degradation to timetable.

## Quick start
```bash
make setup              # uv sync + npm ci
make dev                # API :8000 (timetable only) + UI http://localhost:5173
make test               # backend + frontend unit tests (offline, no key)
make run                # production-style: build the PWA and serve everything from :8000
docker compose up --build   # same, containerised (single worker — see ADR 0001)
```
Rebuild the timetable extract (optional): download `stations.json`, `trains.json`, `schedules.json` from
`github.com/datameet/railways` into `data/open/`, then `make dataset`.

## Layout
`backend/app/{eta,providers,services,api,domain}` · `frontend/src` · `scripts/` · `docs/` · `tests/fixtures/`.
The ETA engine (`eta/`) is pure (no I/O, `now` is a parameter). Providers never leak vendor JSON.

## Quality gates
`make lint` (ruff, mypy --strict on `eta/`+`providers/`, tsc, eslint) · `make test` · `make e2e` (Playwright smoke, real browser).
CI must run with no network and no API key.

## Known gaps / next steps
1. **Run Phase 0** with a RailRadar key; fill the decision table; verify provider field mappings; record fixtures + `ReplayProvider`.
2. Implement RailRadar `get_schedule` (current catalogue, run-days) once its shape is known.
3. Real track geometry (OSM) and a self-hosted tile source; today's map is a straight polyline on a blank background.
4. Tamil UI (message catalogue exists in `frontend/src/i18n/en.ts`), notifications, SSE (Phase 5).
5. Runbook/backups/metrics (Phase 4). Not done: Lighthouse audit (target ≥ 90) has not been run.
