import { loadCatalogue } from "./local/catalogue";
import { config } from "./local/config";
import { ApiError } from "./local/errors";
import { RailRadarClient } from "./local/railradar";
import { QueryService } from "./local/service";
import { combineIst, isoIst } from "./local/time";
import { effectiveLive, loadLiveSettings, onLiveSettingsChange } from "./local/settings";

export type { DataMode, EtaSource } from "./local/domain";
import type { DataMode, EtaSource } from "./local/domain";

export interface Meta {
  data_mode: DataMode;
  fetched_at: string;
  source: string;
  stale_seconds: number | null;
  timetable_note: string;
  live_configured: boolean;
}
export interface Station { code: string; name: string; lat: number | null; lng: number | null }
export interface Journey {
  number: string; name: string; kind: string; start_date: string;
  eta_at_a: string; eta_at_b: string; expected_ride_min: number;
  delay_at_a: number | null; state_relative_to_a: string; platform_at_a: number | null;
  source_at_a: EtaSource; source_at_b: EtaSource; data_mode: DataMode; to_name: string;
}
export interface JourneysResponse extends Meta { from: string; to: string; journeys: Journey[] }
export interface StopRow {
  seq: number; station_code: string; station_name: string; scheduled: string | null; eta: string;
  eta_source: EtaSource; delay_min: number | null; confidence: string; state: string;
  stale: boolean; estimated: boolean; platform: number | null;
  lat: number | null; lng: number | null;
}
export interface Position {
  kind: "not_started" | "at_station" | "between" | "terminated" | "cancelled" | "unknown";
  station_code: string | null; prev_station: string | null; next_station: string | null;
  progress: number | null; estimated: boolean;
}
export interface TrainBrief { number: string; name: string; kind: string; from: string; to: string; from_name: string; to_name: string }
export interface TrainLive extends TrainBrief, Meta {
  start_date: string; position: Position; stops: StopRow[]; exceptions: { type: string }[];
}
export interface BoardRow {
  number: string; name: string; start_date: string; to: string; to_name: string; is_terminus: boolean;
  scheduled: string; eta: string; delay_min: number | null; eta_source: EtaSource;
  platform: number | null; state: string;
}
export interface BoardResponse extends Meta { code: string; name: string; hours: number; trains: BoardRow[] }
export interface Line { type: "LineString"; coordinates: [number, number][] }

export { ApiError } from "./local/errors";

// The "API" is now an in-browser service over the bundled timetable (no server; see
// docs/decisions/0003-static-site.md). Method names and response shapes are unchanged.
export interface JourneyOpts { at?: string; horizonH?: number; earlierMin?: number; limit?: number }

let svcPromise: Promise<QueryService> | null = null;

function applyLive(s: QueryService) {
  const e = effectiveLive(loadLiveSettings());
  s.live = e.enabled ? new RailRadarClient(e.baseUrl, e.apiKey, (ep, st, ms) => s.ledger.record(ep, st, ms)) : null;
  s.cache.clear();
}

export function service(): Promise<QueryService> {
  svcPromise ??= loadCatalogue().then((cat) => {
    const s = new QueryService(cat);
    applyLive(s);
    onLiveSettingsChange(() => applyLive(s));
    return s;
  });
  return svcPromise;
}

export const api = {
  stations: async (q: string) => (await service()).searchStations(q),
  journeys: async (from: string, to: string, showDeparted: boolean, o: JourneyOpts = {}): Promise<JourneysResponse> => {
    const s = await service();
    const a = s.checkStation(from), b = s.checkStation(to);
    if (a === b) throw new ApiError(422, "same_station", "from and to must differ");
    const limit = o.limit ?? 15;
    if (o.at) {
      // "Leave at…": a timetable query for that IST time (live delays only make sense for "now").
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(o.at);
      if (!m) throw new ApiError(422, "bad_time", "time must be YYYY-MM-DDTHH:mm");
      const at = combineIst(m[1], Number(m[2]) * 60 + Number(m[3]));
      const r = await s.journeys(a, b, at, { limit, horizonH: o.horizonH, earlierMin: 0, noLive: true });
      return { ...r, fetched_at: isoIst(Date.now()) };
    }
    return s.journeys(a, b, Date.now(), { limit, horizonH: o.horizonH, showDeparted, earlierMin: o.earlierMin });
  },
  trains: async (q: string) => (await service()).searchTrains(q),
  trainLive: async (n: string) => (await service()).trainLive(n, Date.now()),
  route: async (n: string): Promise<Line> => (await service()).routeGeometry(n),
  config: async () => ({ tile_source_url: config.tileSourceUrl }),
  board: async (code: string, hours: number) => (await service()).board(code, Date.now(), hours),
  status: async () => (await service()).status(),
};
