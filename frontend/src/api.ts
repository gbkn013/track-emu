export type DataMode = "live" | "partial" | "scheduled";
export type EtaSource = "actual" | "live_reported" | "propagated" | "scheduled";

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
  number: string; name: string; to: string; to_name: string; is_terminus: boolean;
  scheduled: string; eta: string; delay_min: number | null; eta_source: EtaSource;
  platform: number | null; state: string;
}
export interface BoardResponse extends Meta { code: string; name: string; hours: number; trains: BoardRow[] }
export interface Line { type: "LineString"; coordinates: [number, number][] }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) {
    let e = { code: "http_error", message: `HTTP ${r.status}` };
    try { e = (await r.json()).error ?? e; } catch { /* non-JSON error body */ }
    throw new ApiError(r.status, e.code, e.message);
  }
  return r.json() as Promise<T>;
}

export const api = {
  stations: (q: string) => get<{ stations: Station[] }>(`/api/v1/stations?q=${encodeURIComponent(q)}`),
  journeys: (from: string, to: string, showDeparted: boolean) =>
    get<JourneysResponse>(`/api/v1/journeys?from=${from}&to=${to}&limit=15${showDeparted ? "&show_departed=true" : ""}`),
  trains: (q: string) => get<{ trains: TrainBrief[] }>(`/api/v1/trains?q=${encodeURIComponent(q)}`),
  trainLive: (n: string) => get<TrainLive>(`/api/v1/trains/${n}/live`),
  route: (n: string) => get<Line>(`/api/v1/trains/${n}/route`),
  config: () => get<{ tile_source_url: string | null }>(`/api/v1/meta/config`),
  board: (code: string, hours: number) => get<BoardResponse>(`/api/v1/stations/${code}/board?hours=${hours}`),
};
