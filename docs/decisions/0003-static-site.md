# ADR 0003 — Ship as a fully static site (no server)

**Status:** accepted (2026-09-26) · **Deviates from:** AGENTS.md §5 (FastAPI service) and §6.3 (server-side quota-aware cache).

**Context.** The user wants to host the app as static files with no server-side component. The backend held no
state that needs a server: the timetable is a 107 KB committed JSON file, saved routes are already client-side, and the
only secret (RailRadar key) is optional and off by default.

**Decision.**
- The whole query layer (ETA engine, journeys, station board, train detail, live cache/single-flight/breaker,
  quota ledger, RailRadar mapping) is ported to TypeScript in `frontend/src/local/` and runs in the browser.
  `frontend/src/api.ts` keeps the same `api.*` interface, so no UI component changed.
- The timetable is bundled as a lazy chunk (`datameet_tn.json`, 5.7 KB gzip) from `backend/app/data/`, the single
  source of truth shared with the Python code. Rebuilding the dataset + `npm run build` refreshes the site.
- The build uses `base: "./"` and the existing hash router, so it works from any path (GitHub Pages project sites,
  Cloudflare Pages, Netlify, S3, `python -m http.server`).
- **Live data stays optional and never ships a key.** A visitor pastes their own RailRadar key on `#/settings`; it is
  stored in that browser's localStorage and sent only to the configured RailRadar base URL. The monthly budget counter
  is per-browser (there is no shared server to count for everyone). Alternatively set `VITE_RAILRADAR_BASE_URL` to a
  small proxy that holds a shared key server-side.
- The Python backend is retained unchanged as the reference implementation (its tests still run) and for the
  Phase 0 probe / dataset scripts. It is no longer required to run the site.

**Consequences.**
- Timetable mode is identical to before — verified by a one-off parity run of the TS service against the Python
  service over 1,414 journey/board/train queries on the real dataset (all equal; only tie order among trains with
  identical ETAs is unspecified in Python).
- **Live mode depends on RailRadar allowing browser calls (CORS) — unverified** (no key available; the response
  shape is also still unverified per Phase 0). If blocked, calls fail, the breaker opens, and the UI falls back to the
  timetable and says so; it never invents live values.
- With per-browser keys the shared-cache benefit of §6.3 is lost: N visitors = N × the upstream calls, each against
  their own quota. A shared key needs a proxy (a server-side component), so it cannot be purely static.
- Never bake a key into the bundle (`VITE_*` values are public). The build reads no key.
