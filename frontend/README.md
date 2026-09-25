# Frontend

React + TypeScript + Vite, TanStack Query, MapLibre GL (lazy), `vite-plugin-pwa`. Dev: `npm run dev` (proxies `/api` to :8000).
Scripts: `npm test` · `npm run lint` · `npm run build` (typechecks first) · `npm run e2e` (needs a build; set `PW_CHROMIUM` to reuse a local Chromium).

## Bundle budget (gzip, measured 2026-09-25)
| Chunk | Size | Loaded |
|---|---|---|
| App (`index-*.js`) | 84 KB | first paint |
| CSS | 2 KB | first paint |
| Map (`TrainMap-*.js` + css) | 275 KB + 11 KB | only when a train page opens |
| MapLibre worker | 144 KB | with the map |

Budget: **first-paint JS ≤ 120 KB gz**; map chunks must stay lazy. Lighthouse has not been run yet (target ≥ 90).

## Notes
- All user strings are in `src/i18n/en.ts` (Tamil catalogue next).
- Times are formatted with `Asia/Kolkata` regardless of the device timezone.
- Provenance rules enforced in UI and tested: no delay chip without a delay figure (never a fake "On time"); timetable-only rows say "Due now (timetable)"; the map marker is dashed unless a position is instrumented.
- maplibre-gl 6 needs its worker bundled explicitly (`?worker&url` + `setWorkerUrl`) — see `TrainMap.tsx`.
