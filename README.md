# TN Rail Tracker

Unofficial EMU/MEMU tracker for Tamil Nadu (Chennai Suburban first): pick **A → B**, see every direct train with ETA at
both ends, open a train for its stop timeline and map, or browse a station board. Installable PWA.
**Informational only — not affiliated with Indian Railways.** See `AGENTS.md` for the full spec.

## What works today (honestly)
- **Timetable mode (default, free, offline):** 130 Tamil Nadu EMU/MEMU trains from the CC0 datameet dataset (~2016).
  Every ETA is labelled *Scheduled*. No live data is claimed. Run days are unknown (assumed daily).
- **Fully static:** the whole app (timetable, ETA engine, journeys, boards, map) runs in the browser — no server
  needed (ADR 0003). `make build` produces `frontend/dist`, deployable to any static host.
- **Live overlay (opt-in, per visitor):** paste your own RailRadar key on the *Live data* tab (kept in your browser
  only; never in the build). Delays are then shown as
  *Live* (recorded/reported) or *Estimated* (last delay carried forward). **The RailRadar mapping is unverified**
  against real responses — run Phase 0 first (`docs/data-source-findings.md`).
- Quota-aware and board-first (in the browser, per visitor): one station-board call per station per 75 s covers all trains (≈ 48 calls/hour while a page is open ⇒ ~20 h/month on the free tier — an estimate). Budget guard, single-flight cache, circuit breaker, stale-serving, graceful degradation to timetable.

## Quick start
```bash
make setup              # uv sync + npm ci
make dev                # UI only, http://localhost:5173 (no backend needed)
make test               # backend + frontend unit tests (offline, no key)
make build              # static site -> frontend/dist  (upload this folder to any static host)
make preview            # serve the built static site locally on :4173
```
Deploying: publish the contents of `frontend/dist/` to GitHub Pages / Cloudflare Pages / Netlify / any web server.
Note: Google Forms cannot host a site; use one of those (or embed the hosted URL in Google Sites).

**GitHub Pages (automated):** `.github/workflows/deploy-pages.yml` builds `frontend/dist` and deploys it on every push
to `main`. One-time setup on GitHub: repo *Settings → Pages → Source* = "GitHub Actions". After the first successful
run, the site is live at `https://<user>.github.io/<repo>/` (uses relative asset paths + hash routing, so it works
under a subpath).
The Python backend (`backend/`, `docker compose`) is kept as the reference implementation and for Phase 0 tooling;
the site no longer calls it.
Rebuild the timetable extract (optional): download `stations.json`, `trains.json`, `schedules.json` from
`github.com/datameet/railways` into `data/open/`, then `make dataset`.

## Layout
`frontend/src/local` (browser ETA engine + services) · `backend/app/{eta,providers,services,api,domain}` (reference) · `frontend/src` · `scripts/` · `docs/` · `tests/fixtures/`.
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
