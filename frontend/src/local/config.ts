// Runtime configuration (AGENTS.md §10). Build-time defaults come from VITE_* env vars;
// the RailRadar key is NEVER baked into the bundle — visitors supply their own (see settings.ts).
const env = import.meta.env as Record<string, string | undefined>;

export const OFFICIAL_BASE_URL = "https://api.railradar.in/v1";

const int = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
};

export const config = {
  monthlyRequestBudget: int(env.VITE_MONTHLY_REQUEST_BUDGET, 1000),
  stationBoardTtlS: int(env.VITE_STATION_BOARD_TTL_S, 75),
  trainLiveTtlS: int(env.VITE_TRAIN_LIVE_TTL_S, 50),
  staleAfterSeconds: int(env.VITE_STALE_AFTER_SECONDS, 300),
  maxStaleSeconds: int(env.VITE_MAX_STALE_SECONDS, 1800),
  /** Official API by default; point at your own key-holding proxy to share one key with all visitors. */
  railradarBaseUrl: env.VITE_RAILRADAR_BASE_URL || OFFICIAL_BASE_URL,
  tileSourceUrl: env.VITE_TILE_SOURCE_URL || null,
};
