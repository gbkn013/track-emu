# Data-source findings

> **Status: Phase 0 (RailRadar reality check) has NOT been run** — no API key was available.
> Nothing below about RailRadar's real-time behaviour is measured. Everything under
> "Free / open sources" was checked directly (2026-09-25). AGENTS.md §4 still applies:
> before relying on live ETAs, run `scripts/phase0_probe.py` and complete the decision table.

## 1. Free / open sources explored

| Source | Gives | Live? | License / terms | Verdict |
|---|---|---|---|---|
| **datameet/railways** (GitHub) | stations (GeoJSON, 8,990), trains (5,208), schedules (417,080 stop rows) | No | **CC0** | **Adopted** as the static timetable (`STATIC_SOURCE=datameet`). Snapshot ~2016. |
| **data.gov.in** "Indian Railways Train Time Table" | train-wise arr/dep, route, distance (same lineage as above, ~2,810 trains) | No | Govt. Open Data licence | Not adopted: same static class, smaller/older than datameet; needs portal download. |
| **OpenStreetMap** rail geometry | true track geometry, station nodes | No | ODbL | Candidate for the map polyline (currently a straight line through stations). Not yet integrated. |
| **GTFS feeds** (Mobility Database) | Chennai **bus (MTC) and metro (CMRL)** only | — | varies | **No Chennai suburban GTFS exists** in the open ecosystem. Not applicable. |
| **Free live train-status feeds** | — | — | — | **None found.** Every real-time source (RailRadar, RapidAPI listings, IndianRailAPI, aggregator sites) is unofficial and/or paid; NTES has no public API. |

### Datameet coverage for Chennai (measured on the extract)
- **130** EMU/MEMU/MRTS trains touching Tamil Nadu, **56** stations (`backend/app/data/datameet_tn.json`, 104 KiB).
- Today's Chennai suburban network runs on the order of **1,000 services/day** ⇒ this snapshot is **partial and dated**.
  Numbers like `43501` (Central → Tiruttani), used as an example in AGENTS.md, are **absent**; ranges present are mainly `40xxx`/`41xxx`.
- Terminal codes like `MAS` (Central) are absent from the data; `MSB` (Beach), `MS` (Egmore), `TBM`, `CGL`, `VLCY` are present.
- **No run-day masks** ⇒ every train is assumed to run daily. Sunday/holiday timetables are not modelled. The API and UI say so (`timetable_note`).
- Timings are ~2016 and may not match today's.

**Consequence:** with free data alone the app is an honest *timetable* app (`data_mode="scheduled"`), never a tracker.
To get the full current catalogue, run-days and live delays, RailRadar (or another paid/unofficial provider) is required.

## 2. RailRadar (unverified)
- Documented free tier: 1,000 requests/month. Endpoints and fields are as summarised in AGENTS.md §3.1.
- `RailRadarProvider` maps `live`, station `board`, and `lookup/trains/local` **from documentation only** (every field alias is unverified; see `providers/railradar.py`). `get_schedule` is intentionally **not implemented** — the shape is unknown until fixtures exist.
- Quota handling is implemented and tested against synthetic 429/503 responses: budget guard (ok/stretch/exhausted), TTL + single-flight cache, circuit breaker with `Retry-After`, stale-serving up to `MAX_STALE_SECONDS`, and degradation to `scheduled`.

## 3. Phase 0 decision table (fill in after running the probe)
| Metric | Result |
|---|---|
| Coverage (% sampled EMUs with genuine live data) | _not measured_ |
| Granularity (station-event vs continuous) | _not measured_ |
| Latency / staleness | _not measured_ |
| Agreement with NTES / ground truth | _not measured_ |
| Quota: cost per call, headers, 429 body | _not measured_ |
| **Recommendation** (go / go-with-degradation / no-go) | **pending** |

Run: `uv run python scripts/phase0_probe.py catalogue`, then `live <trains…>` / `board <codes…>` during a weekday peak
window and again off-peak (≤ 150 calls total; ledger at `data/quota_ledger.jsonl`).

## 4. Open questions carried from AGENTS.md §12
1. Free tier enough for personal use? **Only for light use — estimate, not measured.** Journeys are board-first: one
   `stations/{A}/live` call per station per `STATION_BOARD_TTL_S` (75 s), shared by every viewer of that station. A
   page left open with a live source therefore costs ≈ 48 calls/hour (3,600 s / 75 s), so **1,000 calls ≈ 20 hours of
   active viewing per month** (the page only refetches while its tab is visible). Opening a train adds one
   `trains/{n}/live` call per 50 s. At >80 % of `MONTHLY_REQUEST_BUDGET` the TTLs triple; at 100 % the app serves
   the timetable only (`data_mode="scheduled"`). A paid tier is needed for a public deployment. Confirm the real
   per-call cost after Phase 0 (question 4).
2. MRTS present with usable live data? Datameet has MRTS-named trains; live unknown.
3–5. Live-vs-echo fields, per-request cost, provider terms on caching/redistribution: **unknown** until Phase 0 / reading RailRadar's terms.
6. Tile source: default is **no basemap** (route + stations on a plain background). Set `TILE_SOURCE_URL` to a self-hosted PMTiles/raster endpoint.
