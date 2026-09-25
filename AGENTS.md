# AGENTS.md — TN Rail Tracker (EMU/MEMU, Tamil Nadu)

> Read this whole file before writing any code. Sections marked **VERIFY** contain assumptions
> that were taken from vendor documentation and NOT tested against real data. Phase 0 exists
> to test them. If a Phase 0 result contradicts this file, **stop, write up the finding in
> `docs/data-source-findings.md`, and propose a design change** — do not silently work around it.

---

## 1. Mission

Build a web app (installable PWA) that lets a commuter:

1. **Pick two stations (A → B)** and see every EMU/MEMU service between them in the next few hours, each with a live-adjusted **ETA at A** and **ETA at B**, delay, status, and platform where known.
2. **Open one individual train** and see where it is now (last/next station, progress between them), a per-station ETA table for the rest of its run, and a map.
3. **Open a station board**: what is arriving/departing now, with delays.
4. Save frequent routes.

Scope: **Tamil Nadu suburban and mainline-EMU services**, starting with the Chennai Suburban network, then other TN MEMU services discovered through the data source. Trains that leave TN (e.g. to Tirupati, Bitragunta, Puducherry) are in scope as long as they are EMU/MEMU; render the whole run, don't truncate at the state border.

Non-goals (v1): ticketing/UTS, fares, PNR, seat availability, long-distance express trains as first-class citizens, user accounts, crowdsourced GPS.

**Safety note:** this is an informational tool. Never present output as authoritative for operational or safety decisions; show data freshness and source on every live view.

---

## 2. Domain primer (so you don't guess)

- **EMU** = Electric Multiple Unit (suburban). **MEMU** = Mainline EMU (runs on mixed-traffic tracks over longer distances). Both are numbered with 5-digit train numbers in the Indian Railways system; Chennai suburban numbers are observed in the 4xxxx range (e.g. `43501` Chennai Central Suburban → Tiruttani; `40567` Chennai Beach → Chengalpattu). **Do not hard-code number ranges** — enumerate them from the API (see §4).
- Chennai Suburban lines (each has slow/fast/MEMU variants): **South** (Beach–Egmore–Tambaram–Chengalpattu; MEMUs onward to Villupuram/Puducherry), **South West** (Beach–Chengalpattu–Kanchipuram–Arakkonam), **West** (Central–Avadi–Tiruvallur–Arakkonam; MEMUs to Katpadi/Jolarpettai), **West North** (Central–Arakkonam–Tirupati/Tiruttani), **North** (Central–Ennore/Gummidipoondi–Sullurpeta; MEMUs to Bitragunta), plus the **MRTS** (Beach–Velachery).
- **Journey date ≠ calendar date.** A train that starts at 23:40 and reaches a station at 00:20 belongs to the *previous* day's run. Every run is keyed by `(train_number, start_date)`. First trains ≈ 03:55, last ≈ 23:59, so midnight rollover is a routine case, not an edge case.
- **Timezone:** everything is `Asia/Kolkata` (IST, UTC+05:30, no DST). Store UTC in the DB, convert at the edges. Never use naive datetimes.
- **Run days / special timetables:** Sunday and holiday timetables differ; trains have run-day masks; some are cancelled, short-terminated, diverted, or rescheduled on a given date. The live payload carries an `exceptions` array — model it.
- **Fast vs slow:** the same pair of stations can be served by trains that stop at both, only at one, or skip one. "Trains between A and B" must only return trains that **halt at both A and B, with A before B in the run's direction**.
- Station codes are Indian Railways codes (e.g. `MAS` Chennai Central, `MSB` Chennai Beach, `TBM` Tambaram, `CGL` Chengalpattu, `TRT` Tiruttani). Suburban terminals may have separate codes from the mainline terminal (e.g. Chennai Central *Suburban*). Get codes from the API's station directory, never from memory.

---

## 3. Data source exploration — findings

Explored during spec authoring. Ranked by how well each fits this project.

### 3.1 Primary candidate: RailRadar API (`https://api.railradar.in/v1`)

Developer-oriented REST API backed by NTES-derived data. Auth: `Authorization: Bearer rr_live_…` (or `X-API-Key`). Standard envelope:

```json
{ "success": true, "data": { … }, "meta": { "traceId": "…", "timestamp": "…", "executionTime": 24, "source": "database" } }
```

| Endpoint | Use in this app |
|---|---|
| `GET /lookup/trains/local?city=Chennai` | **Enumerate Chennai suburban trains** (returns `{ "<number>": "<NAME>" }`). Seed the train catalogue from here. |
| `GET /lookup/trains/local/cities` | Confirm supported cities and counts. |
| `GET /trains/{number}` | Static schedule: stops, halts, run days. |
| `GET /trains/{number}/live?date=YYYY-MM-DD` | Live status for one run. Fields of interest: `delayMinutes`, `status`, `lastUpdatedAt`, `isLive`, `currentLocation {stationCode, status, isActualPosition, segmentProgress 0–1, speedKmh, bearingDegrees}`, `previousHalt`, `nextHalt`, `route[]` (per-stop `scheduled*`/`actual*`/`delay*`/`platform`/`status`), `exceptions[]` (DIVERTED / partially cancelled / rescheduled). Options: `authoritative=true` (bypass cache — costs upstream load, use sparingly), `haltsOnly`, `geometry`, `includeCoordinates`. |
| `GET /trains/{number}/route` | GeoJSON/polyline track geometry for the map. |
| `GET /stations/{code}/live?hours=2\|4\|6\|8&includeIntermediate=` | **Live station board**: every train in window `[now−4h, now+hoursAhead]` with per-train `live.type` (`at-station`/`upcoming`/`departed`/`scheduled`), `expectedDepartureTime`, `delayMinutes`, `platform`. **One call covers all trains at a station** — this is the quota-efficient path for A→B queries. |
| `GET /stations/{code}/trains` | Static station timetable. |
| `GET /trains/between/{from}/{to}` | Static trains-between-stations. |
| `GET /lookup/stations`, `/lookup/search/stations`, `/lookup/search/trains` | Station directory (with coordinates) and autocomplete. |
| `GET /trains/{number}/coaches` etc. | Out of scope. |

**Hard constraints from the docs:**
- Free sandbox tier = **1,000 requests/month**. That is ~33/day: enough for development and fixtures, **not** for a live public app. Design for a paid tier or strict on-demand caching (see §6.3).
- Train numbers are documented as 5-digit strings.
- HTTP 429 = quota; 503 = "upstream transit telemetry provider temporarily degraded" (treat as transient, back off).

### 3.2 Official source: NTES (`enquiry.indianrail.gov.in`, run by CRIS)

The authoritative origin of running-status data ("Spot Your Train", Live Station, Trains B/W Stations). **No public, documented API.** Third-party sites reach it by unofficial means. Policy for this project:
- **Do not** scrape NTES/IRCTC, bypass captchas, or otherwise circumvent access controls. If a documented/permitted access route exists, implement it behind the provider interface (§6.1) as an **opt-in, disabled-by-default** provider and record the terms in `docs/data-source-findings.md`.
- Use NTES's public web UI manually only as a **ground-truth reference** when validating Phase 0.

### 3.3 Other options (all unofficial; lower priority)

- **RapidAPI listings** (e.g. "Indian Railway IRCTC" — self-described unofficial; Qrail-style live status APIs). Same class of risk as RailRadar with less transparency. Candidate *secondary* providers behind the same interface.
- **Aggregator sites** (ixigo, RailYatri, ConfirmTkt, etrain, indiarailinfo, runningstatus.in, trainspnrstatus.com, Moovit) show Chennai EMU pages, including live-status pages for numbers like 43501 and 40567. **This does not prove the underlying live data is real-time for suburban EMUs.** Treat as reference only; do not scrape.
- **GTFS:** no official or maintained Chennai suburban GTFS feed was found. Static timetable therefore comes from the API (§3.1) and is cached locally.
- **Map data:** OpenStreetMap for rail geometry; the API also returns route geometry per train.

### 3.4 The critical unknown — **VERIFY in Phase 0**

Whether upstream sources publish **genuine real-time position/delay for Chennai suburban EMUs and MEMUs** (as opposed to schedule-only records that merely look live) is **not established by documentation**. Suburban EMUs are historically thinly instrumented compared with long-distance trains, so this could be sparse, coarse (station-level, updated on arrival/departure only), delayed, or absent for some services. The whole product's value depends on the answer, so Phase 0 measures it before anything else is built.

---

## 4. Phase 0 — Data reality check (do this first, ship nothing else)

Deliverable: `docs/data-source-findings.md` + recorded fixtures in `tests/fixtures/railradar/`. No UI.

Requires `RAILRADAR_API_KEY` in `.env` (ask the user; never commit; never print). **Budget: ≤ 150 API calls for all of Phase 0.** Log every call in `data/quota_ledger.jsonl` (timestamp, endpoint, status, ms).

Steps:
1. `GET /lookup/trains/local?city=Chennai` → save. Report count and number-range distribution; classify (EMU/MEMU/MRTS if inferable from name).
2. `GET /lookup/stations` (or search) → confirm codes and lat/lng for: Chennai Central, Central Suburban, Beach, Egmore, Tambaram, Chengalpattu, Avadi, Tiruvallur, Arakkonam, Velachery, Gummidipoondi, Sullurpeta, Tiruttani, Villupuram, Jolarpettai.
3. During a **weekday peak window** (07:30–10:00 or 17:00–20:00 IST) and again **off-peak**, call `GET /trains/{n}/live` for ~8 trains that are currently mid-run across ≥3 lines. For each record: `isLive`, `lastUpdatedAt` (age vs now), `currentLocation.isActualPosition`, whether `segmentProgress`/`speedKmh` are present or null, how many `route[]` stops have `actual*` filled, and how delays evolve across two calls ~5–10 min apart.
4. Call `GET /stations/{code}/live?hours=2` for Beach, Tambaram, Chengalpattu, Central. Check: are EMUs present? Are `delayMinutes` populated (not always 0/null)? Are non-halting/fast trains included? Does the board agree with per-train `/live`?
5. **Ground truth:** ask the user to compare 3–5 trains against NTES "Spot Your Train" or against where they physically are, and record agreement.
6. Measure upstream freshness: how often does data for the same train actually change?
7. Check quota headers (`X-RateLimit-*` or similar) and document what the 429 body looks like.

Write findings as: **coverage** (% of sampled EMUs with genuine live data), **granularity** (station-event vs continuous), **latency**, **agreement with ground truth**, **quota implications**, and a **go / go-with-degradation / no-go** recommendation for live ETAs. Then stop and wait for the user's review before Phase 1.

Decision rules:
- **Go:** ≥ ~70% of sampled EMUs show genuine, recent (≤ 10 min stale) actuals → build live-first (§6).
- **Go with degradation:** live is patchy → build schedule-first with live overlay; the UI must clearly label which ETAs are live vs scheduled (§7). This is the likely outcome; the design in §6 already supports it.
- **No-go:** no meaningful live data for suburban EMUs → propose alternatives to the user (other providers, a crowdsourced-GPS design) instead of shipping a tracker that shows fake precision.

---

## 5. Architecture

```
┌────────────┐   HTTPS/JSON    ┌─────────────────────────────┐    ┌─────────────────────┐
│ PWA (React)│ ───────────────▶│ API service (FastAPI)       │───▶│ Postgres (or SQLite │
│ MapLibre   │◀── SSE/poll ────│  • query endpoints          │    │ for MVP)            │
└────────────┘                 │  • ETA engine (pure funcs)  │    └─────────────────────┘
                               │  • provider adapters        │    ┌─────────────────────┐
                               │  • quota-aware cache        │───▶│ Redis (cache,       │
                               └──────────────┬──────────────┘    │ single-flight, rate)│
                                              │                   └─────────────────────┘
                               ┌──────────────▼──────────────┐
                               │ Worker (poller/scheduler)   │──▶ RailRadarProvider (+ others)
                               └─────────────────────────────┘
```

Default stack (change only with a written reason in `docs/decisions/`):
- **Backend:** Python 3.12, FastAPI, httpx (async), Pydantic v2, SQLAlchemy 2 + Alembic, APScheduler (or ARQ) for the worker, `uv` for dependency management.
- **DB:** Postgres in Docker Compose; SQLite acceptable for local dev if the schema stays portable.
- **Cache:** Redis (TTL cache, request coalescing, quota counters). Fall back to in-process cache if Redis is absent.
- **Frontend:** React + TypeScript + Vite, TanStack Query, MapLibre GL JS, `vite-plugin-pwa`. Mobile-first; must be usable one-handed on a crowded platform.
- **Map tiles:** do **not** hotlink OpenStreetMap's public tile servers for production traffic (their usage policy forbids heavy use). Use a self-hostable Protomaps/PMTiles extract of Tamil Nadu or a provider with an explicit free tier; keep the tile source configurable.
- **Deployment:** Docker Compose, all config via env vars, runs on a single self-hosted Linux host behind a reverse proxy. No hard dependency on any cloud service. Health endpoint at `/healthz`.

### 5.1 Repository layout

```
.
├── AGENTS.md
├── CLAUDE.md                # single line: @AGENTS.md
├── docs/
│   ├── data-source-findings.md
│   └── decisions/           # short ADRs
├── backend/
│   ├── app/
│   │   ├── api/             # routers
│   │   ├── core/            # config, logging, time utils (IST), errors
│   │   ├── domain/          # dataclasses: Station, Train, Stop, Run, LiveSnapshot, Eta
│   │   ├── eta/             # pure ETA engine — no I/O
│   │   ├── providers/       # base.py, railradar.py, mock.py, (ntes.py disabled)
│   │   ├── services/        # catalog sync, live cache, quota ledger, query services
│   │   ├── db/              # models, migrations
│   │   └── worker/
│   └── tests/
├── frontend/
├── data/                    # gitignored: ledger, local DB
├── tests/fixtures/          # recorded provider responses (committed, keys scrubbed)
└── docker-compose.yml
```

---

## 6. Backend design

### 6.1 Provider interface (mandatory abstraction)

The rest of the app never sees RailRadar's JSON. Define in `providers/base.py`:

```python
class RailDataProvider(Protocol):
    name: str
    async def list_local_trains(self, city: str) -> list[TrainRef]: ...
    async def get_schedule(self, train_no: str) -> TrainSchedule: ...
    async def get_live_run(self, train_no: str, start_date: date | None) -> LiveRun: ...
    async def get_station_board(self, code: str, hours_ahead: int) -> StationBoard: ...
    async def get_route_geometry(self, train_no: str) -> GeoJSONLine: ...
    async def list_stations(self) -> list[Station]: ...
```

Implementations: `RailRadarProvider` (primary), `MockProvider` / `ReplayProvider` (serves recorded fixtures — **all dev and CI runs use this; CI must never hit the network**), `NtesProvider` (stub, disabled). Map upstream fields to domain types in one place per provider, with Pydantic models that **tolerate missing/extra fields** and log schema drift rather than crash.

### 6.2 Domain model (core tables)

- `stations(code PK, name, lat, lng, zone, is_suburban)`
- `trains(number PK, name, kind {EMU|MEMU|MRTS|OTHER}, source, destination, run_days, updated_at)`
- `schedule_stops(train_number, seq, station_code, arr_offset_min, dep_offset_min, day_offset, is_halt, distance_km)` — offsets from origin departure, so a schedule can be applied to any journey date
- `runs(train_number, start_date, status {scheduled|running|completed|cancelled|partially_cancelled}, PK(train_number,start_date))`
- `live_snapshots(id, train_number, start_date, fetched_at, upstream_updated_at, delay_min, current_station, position_state, segment_progress, is_actual_position, raw_json)` — keep raw JSON for debugging, prune after N days
- `run_exceptions(train_number, start_date, type, payload_json)`
- `quota_ledger(ts, provider, endpoint, status, latency_ms, cost)`
- `saved_routes` — **client-side (localStorage) in v1**; no accounts.

### 6.3 Quota-aware fetching (the design consequence of §3.1)

1. **Station-board-first.** For an A→B query, fetch `/stations/A/live` and `/stations/B/live` (2 calls) instead of N per-train calls. Join by `(train, start_date)` for delays at both ends. Only call per-train `/live` when the user opens a single train, or when a board lacks data needed for the ETA.
2. **TTL cache with single-flight:** identical concurrent requests share one upstream call. Default TTLs (env-configurable): station board 60–90 s, train live 45–60 s, static schedule/catalogue 24 h (refresh nightly ~03:00 IST, before first trains).
3. **Global budget guard:** `MONTHLY_REQUEST_BUDGET` and a daily pacing target. When >80% consumed, stretch TTLs; when exhausted, **degrade to schedule-only** and set `data_mode="scheduled"` in responses — never error out and never fabricate live values.
4. **Active-window polling only:** the worker polls a station/train only if a client has requested it in the last N minutes ("hot set"); no blanket polling of every train.
5. `authoritative=true` is never used by default; expose it only as an admin/debug flag.
6. Exponential backoff with jitter on 5xx/503; honour `Retry-After` on 429; circuit breaker after repeated failures (serve stale-with-warning up to `MAX_STALE_SECONDS`).
7. `POLL_MODE=on_demand|scheduled` config, default `on_demand`.

### 6.4 ETA engine (`backend/app/eta/`, pure functions, heavily tested)

Inputs: schedule stops for the run, latest live snapshot (if any), `now`. Output per stop: `eta`, `eta_source`, `delay_min`, `confidence`, `state`.

`eta_source` is one of:
- `actual` — the train already arrived/departed; the value is a recorded actual.
- `live_reported` — upstream supplied an expected time/delay for this stop.
- `propagated` — computed by carrying the last known delay forward.
- `scheduled` — no live information; timetable time only.

Propagation rule (start simple, make it a swappable strategy): `eta = scheduled + last_delay`, with optional **recovery** — subtract up to `RECOVERY_MIN_PER_SEGMENT` (default 0 in v1, tuned later from data) where the timetable has slack — and never let an ETA precede the last recorded actual. If the last update is older than `STALE_AFTER_SECONDS`, downgrade `confidence` and add a `stale` flag. **Never** upgrade a scheduled time to look live.

Position state for a run: `not_started | at_station(code) | between(prev, next, progress?) | terminated | cancelled | unknown`. `progress` is only reported if upstream gives `isActualPosition=true`; otherwise interpolate from timing and flag `estimated_position=true`.

A→B result per train: `eta_at_A`, `eta_at_B`, `expected_ride_min`, `delay_at_A`, `state_relative_to_A` (`upcoming | arriving | at_station | already_departed`), `platform_at_A`, `sources`. Sort by `eta_at_A`; hide trains already past A unless a "show departed" toggle is on. Only include trains that halt at both stations in the correct order.

### 6.5 Own REST API (what the frontend consumes)

All times ISO-8601 with `+05:30`. Every live response includes `data_mode` (`live | partial | scheduled`), `fetched_at`, `source`, and `stale_seconds`.

```
GET /api/v1/stations?q=                         autocomplete (from local catalogue)
GET /api/v1/stations/{code}/board?hours=2|4|6|8
GET /api/v1/journeys?from=TBM&to=MSB&after=now&limit=10
GET /api/v1/trains?q=                           search by number/name
GET /api/v1/trains/{number}                     static schedule
GET /api/v1/trains/{number}/live?date=          live run + per-stop ETAs + position state
GET /api/v1/trains/{number}/route               GeoJSON
GET /api/v1/meta/status                         quota usage, provider health, cache stats
GET /healthz
```

Optional: `GET /api/v1/trains/{number}/stream` (SSE) pushing snapshot updates — implement only after polling works.

Errors use one JSON shape `{ "error": { "code", "message", "traceId" } }`. Validate station codes and train numbers (`^\d{5}$`) at the edge.

---

## 7. Frontend / UX requirements

- **Home:** two station pickers (A, B) with swap button, recent + saved routes, "next trains" list.
- **Journey list row:** departure ETA at A (large), arrival ETA at B, delay chip (`On time`, `+6 min`), train number/name, platform, and a **source badge**: 🟢 live · 🟡 estimated · ⚪ scheduled. Provide non-emoji, accessible equivalents (icon + text).
- **Train detail:** header with position sentence ("Between Guindy and Saidapet — next: Saidapet, ETA 08:42, +4 min"), vertical stop timeline with scheduled vs expected times, map with route line + train marker (marker only when `isActualPosition` or clearly styled as estimated).
- **Station board:** arrivals/departures tabs, delay, platform, pull-to-refresh.
- **Freshness banner** on every live screen: "Updated 40 s ago · via RailRadar". Turn amber past `STALE_AFTER_SECONDS`, and show "Live data unavailable — showing timetable" when `data_mode=scheduled`.
- **States:** loading skeletons, empty ("no trains in next N hours"), error with retry, offline (serve last cached timetable via service worker).
- Performance: first useful paint < 2 s on a mid-range phone over 4G; bundle budget documented in `frontend/README`.
- Accessibility: WCAG 2.1 AA contrast, screen-reader labels for delay/status chips, large tap targets.
- i18n-ready from day one (English first; Tamil next). No hard-coded user-facing strings outside a message catalogue. Station names may need Tamil transliterations — leave a nullable `name_ta` column.
- Attribution/footers: state the data provider, "unofficial — not affiliated with Indian Railways", and the informational-use disclaimer.

---

## 8. Phased plan

| Phase | Goal | Exit criteria |
|---|---|---|
| **0** | Data reality check (§4) | `docs/data-source-findings.md` reviewed and approved by the user |
| **1** | Catalogue + schedule: sync stations, Chennai local trains, schedules, geometry into DB; `ReplayProvider`; ETA engine with schedule-only mode; unit tests | `journeys` endpoint returns correct scheduled A→B results for 10 hand-checked pairs incl. a midnight-crossing case |
| **2** | Live overlay: quota-aware fetching, station-board-first, propagation, freshness/`data_mode` | Live data visibly improves ETAs when available; graceful degradation verified by tests that simulate 429/503/stale |
| **3** | Frontend MVP: journey list, train detail, station board, PWA | Works on a phone; Lighthouse PWA/perf/accessibility ≥ 90 |
| **4** | Hardening: Compose deployment, metrics, logging, backups, docs | One-command deploy; runbook in `docs/` |
| **5** | Stretch: SSE, notifications ("train approaching A"), Tamil UI, other TN MEMU corridors, second provider | Per-item ADR |

Do not start a phase before the previous exit criteria are met and the user has seen the result.

---

## 9. Testing & quality

- **pytest + pytest-asyncio + respx** for HTTP mocking; **freezegun** (or explicit clock injection) for time. The ETA engine takes `now` as a parameter — no hidden `datetime.now()`.
- Required ETA test cases: on time; delayed; early; train not yet started; at-station; between stations; terminated; cancelled; partially cancelled; diverted; skipped stop; A or B not a halt; wrong direction; midnight crossing (start 23:40, pass B at 00:25); stale snapshot; missing `actual*` fields; upstream returns nulls.
- **Contract tests** against recorded fixtures for every provider; a fixture-refresh script (`scripts/record_fixtures.py`) that spends real quota only when run manually and scrubs API keys.
- Property tests (hypothesis): ETA at a later stop is never earlier than at an earlier stop; result ordering stable; no naive datetimes.
- Frontend: Vitest + Testing Library; Playwright smoke tests against the Replay backend.
- Tooling: `ruff`, `mypy --strict` on `eta/` and `providers/`, `eslint`, `tsc --noEmit`, pre-commit. CI runs all of it with **no network and no API key**.

---

## 10. Commands (create these; keep them working)

```
make setup        # uv sync, npm ci, pre-commit install
make dev          # docker compose up db redis; run backend + worker + vite with ReplayProvider
make dev-live     # same, but RailRadarProvider (requires RAILRADAR_API_KEY; spends quota)
make test         # backend + frontend unit tests (offline)
make lint         # ruff, mypy, eslint, tsc
make fixtures     # record fresh provider fixtures (manual; spends quota)
make migrate      # alembic upgrade head
```

Environment variables (all documented in `.env.example`, no secrets committed):
`RAILRADAR_API_KEY`, `PROVIDER=railradar|replay`, `DATABASE_URL`, `REDIS_URL`, `MONTHLY_REQUEST_BUDGET`, `POLL_MODE`, `STATION_BOARD_TTL_S`, `TRAIN_LIVE_TTL_S`, `STALE_AFTER_SECONDS`, `MAX_STALE_SECONDS`, `TILE_SOURCE_URL`, `LOG_LEVEL`.

---

## 11. Working agreement for the agent

**Do**
- Start with Phase 0. Report findings before building further.
- Keep changes small and commit in logical steps; write/adjust tests in the same change.
- Log every upstream call to the quota ledger; keep a running "quota spent" note in your progress updates.
- Put unknowns in `docs/data-source-findings.md` rather than guessing; label assumptions as such.
- Ask before adding a new runtime dependency, changing the stack, or enabling any provider other than RailRadar/Replay.
- Redact API keys and personal data from logs, fixtures and error messages.

**Don't**
- Don't scrape NTES/IRCTC or any site whose terms disallow it; don't bypass captchas, auth, or rate limits.
- Don't hit the live API from tests, CI, or hot-reload loops. Use fixtures.
- Don't present scheduled times as live, and don't invent positions. Precision you don't have must not be shown.
- Don't hard-code station codes, train-number ranges, or timetables from memory; fetch and cache them.
- Don't use naive datetimes or `date.today()` without an explicit IST timezone.
- Don't commit `.env`, the SQLite DB, or `data/`.
- Don't add accounts, analytics trackers, or ads.

**Definition of done (any task):** tests pass offline; lint/type checks clean; docs and `.env.example` updated; quota impact stated; the UI shows data provenance for anything live.

---

## 12. Open questions to resolve (record answers in `docs/decisions/`)

1. Does the free tier suffice for a personal-use deployment, or is a paid plan needed? (Answer after Phase 0 measurements + §6.3 budget maths.)
2. Are MRTS (Beach–Velachery) trains present in the local-trains list with usable live data?
3. Which upstream fields reliably distinguish genuine live actuals from schedule echoes?
4. Is a per-request cost/weight reported by the provider, or is every call 1 unit?
5. What is the provider's terms position on caching, redistribution, and displaying data in a public app?
6. Preferred tile source for TN (self-hosted PMTiles vs hosted provider)?
