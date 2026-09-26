# Frontend

React + TypeScript + Vite, TanStack Query, MapLibre GL (lazy), `vite-plugin-pwa`. Fully static: no backend — the query layer lives in `src/local/` (see ADR 0003). Dev: `npm run dev`.
Scripts: `npm test` · `npm run lint` · `npm run build` (typechecks first) · `npm run e2e` (needs a build; serves `dist/` with `vite preview`; set `PW_CHROMIUM` to reuse a local Chromium).

## Bundle budget (gzip, measured 2026-09-25)
| Chunk | Size | Loaded |
|---|---|---|
| App (`index-*.js`) | 99 KB | first paint |
| Timetable (`datameet_tn-*.js`) | 6 KB | first query |
| CSS | 2 KB | first paint |
| Map (`TrainMap-*.js` + css) | 275 KB + 11 KB | only when a train page opens |
| MapLibre worker | 144 KB | with the map |

Budget: **first-paint JS ≤ 120 KB gz**; map chunks must stay lazy. Lighthouse has not been run yet (target ≥ 90).

## Notes
- All user strings are in `src/i18n/en.ts` (Tamil catalogue next).
- Times are formatted with `Asia/Kolkata` regardless of the device timezone.
- Provenance rules enforced in UI and tested: no delay chip without a delay figure (never a fake "On time"); timetable-only rows say "Due now (timetable)"; the map marker is dashed unless a position is instrumented.
- maplibre-gl 6 needs its worker bundled explicitly (`?worker&url` + `setWorkerUrl`) — see `TrainMap.tsx`.
- Build config (all optional, all public — never put a secret here): `VITE_TILE_SOURCE_URL`, `VITE_MONTHLY_REQUEST_BUDGET`,
  `VITE_STATION_BOARD_TTL_S`, `VITE_TRAIN_LIVE_TTL_S`, `VITE_STALE_AFTER_SECONDS`, `VITE_MAX_STALE_SECONDS`,
  `VITE_RAILRADAR_BASE_URL` (point at your own proxy that holds a shared key). See `.env.example`.
- The RailRadar key is entered by each visitor on `#/settings` and stored only in their localStorage.

## UI (TripView-style)
- Layout and theme follow the TripView pattern: orange header bar, **Trips** home (saved trips as cards with the next
  three departures + countdowns, then recent trips), **New trip**, a **trip** screen (direct trains with
  "Leave at…", earlier/later trains, day headings), a **train** screen (position card, map, stop timeline with
  Board/Get off tags), station board, find-a-train, and Settings (Light / Dark / System, live key, data, about).
- Theme tokens live at the top of `src/styles.css`; Light/Dark/System is a class on `<html>` applied before first paint
  (`index.html`) and set from Settings (`src/theme.ts`). Icons are inline SVG (`components/Icons.tsx`) — no icon dependency.
- Routes (hash): `#/`, `#/new`, `#/trip/FROM/TO[?at=YYYY-MM-DDTHH:mm]`, `#/train/NUM[/FROM/TO]`, `#/station/CODE`,
  `#/board`, `#/trains`, `#/settings`.
- Provenance is kept on every departure (source badge), plus the freshness banner and disclaimer.
- Known trade-off: white text on the brand orange (#f58220) is ~2.6:1 contrast, below WCAG AA for small text — this is the
  TripView palette. Darken `--brand` in `styles.css` if AA matters more than matching the look.
