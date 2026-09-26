// RailRadar live provider (AGENTS.md §3.1), called straight from the browser with the visitor's
// own key. UNVERIFIED: field names come from the vendor docs summary, not recorded responses;
// mapping is tolerant (missing/renamed fields become null, never exceptions).
import type { BoardEntry, CurrentLocation, LiveRun, RouteStop, RunStatus, StationBoard } from "./domain";
import { newLiveRun } from "./domain";
import { ProviderError, QuotaExceeded, UpstreamDegraded } from "./errors";
import { parseIso, pyRound, type DateStr } from "./time";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

const pick = (d: Json, ...names: string[]): unknown => {
  for (const n of names) if (d[n] !== undefined && d[n] !== null) return d[n];
  return null;
};
const toInt = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? pyRound(n) : null;
};
const toStr = (v: unknown): string | null => (typeof v === "string" ? v : v == null ? null : String(v));
const toNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const STATUS: Record<string, RunStatus> = {
  cancelled: "cancelled", canceled: "cancelled", diverted: "diverted",
  partially_cancelled: "partially_cancelled", completed: "completed", scheduled: "scheduled",
};

/** Vendor `/trains/{n}/live` `data` -> LiveRun (tolerant). */
export function mapLive(number: string, start: DateStr, data: Json): LiveRun {
  const locRaw = isObj(data.currentLocation) ? data.currentLocation : null;
  const loc: CurrentLocation | null = locRaw && Object.keys(locRaw).length
    ? {
        station_code: toStr(pick(locRaw, "stationCode")),
        status: toStr(pick(locRaw, "status")),
        is_actual_position: Boolean(locRaw.isActualPosition),
        segment_progress: toNum(pick(locRaw, "segmentProgress")),
        speed_kmh: toNum(pick(locRaw, "speedKmh")),
        bearing_degrees: toNum(pick(locRaw, "bearingDegrees")),
      }
    : null;
  const stopCode = (v: unknown) => (isObj(v) ? toStr(v.stationCode) : toStr(v));

  const route: RouteStop[] = [];
  (Array.isArray(data.route) ? data.route : []).forEach((r, i) => {
    if (!isObj(r)) { console.warn("schema drift: non-object route row"); return; }
    route.push({
      seq: i, // re-aligned to the schedule by station code in the service layer
      station_code: String(pick(r, "stationCode", "code") ?? ""),
      station_name: toStr(pick(r, "stationName", "name")),
      status: toStr(pick(r, "status")),
      scheduled_arrival: parseIso(pick(r, "scheduledArrival")),
      scheduled_departure: parseIso(pick(r, "scheduledDeparture")),
      actual_arrival: parseIso(pick(r, "actualArrival")),
      actual_departure: parseIso(pick(r, "actualDeparture")),
      delay_minutes: toInt(pick(r, "delayArrivalMinutes", "arrivalDelayMinutes", "delayMinutes")),
      platform: toInt(pick(r, "platform")),
    });
  });
  const statusRaw = String(pick(data, "status") ?? "").toLowerCase().replace(/ /g, "_");
  return newLiveRun(number, start, {
    status: STATUS[statusRaw] ?? "running",
    is_live: Boolean(data.isLive),
    last_updated_at: parseIso(pick(data, "lastUpdatedAt")),
    delay_minutes: toInt(pick(data, "delayMinutes")),
    current_location: loc,
    previous_halt: stopCode(data.previousHalt),
    next_halt: stopCode(data.nextHalt),
    route,
    exceptions: (Array.isArray(data.exceptions) ? data.exceptions : [])
      .filter(isObj)
      .map((x) => ({ type: String(pick(x, "type") ?? "UNKNOWN"), payload: x })),
  });
}

export function mapBoard(code: string, data: Json): StationBoard {
  const rows = pick(data, "trains", "entries");
  const entries: BoardEntry[] = [];
  for (const t of Array.isArray(rows) ? rows : []) {
    if (!isObj(t)) continue;
    const live = isObj(t.live) ? t.live : {};
    const num = pick(t, "trainNumber", "number");
    if (num === null) continue;
    entries.push({
      train_number: String(num),
      train_name: toStr(pick(t, "trainName", "name")),
      live_type: String(pick(live, "type") ?? "scheduled"),
      expected_departure_time: parseIso(pick(live, "expectedDepartureTime")),
      delay_minutes: toInt(pick(live, "delayMinutes")),
      platform: toInt(pick(live, "platform", "platformNumber") ?? pick(t, "platform")),
    });
  }
  return { code, entries };
}

/** What the query service needs from a live source. */
export interface LiveProvider {
  name: string;
  getLiveRun(number: string, start: DateStr): Promise<LiveRun>;
  getStationBoard(code: string, hoursAhead: number): Promise<StationBoard>;
}

export type LedgerHook = (endpoint: string, status: number, latencyMs: number) => void;

export class RailRadarClient implements LiveProvider {
  name = "railradar";

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private ledger?: LedgerHook,
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async get(path: string, params?: Record<string, string | number>): Promise<Json> {
    const qs = params ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` : "";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const t0 = performance.now();
    let status = 0;
    let r: Response;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    try {
      r = await this.fetchImpl(`${this.baseUrl}${path}${qs}`, { headers, signal: ctl.signal });
      status = r.status;
    } catch (e) {
      // Network failure, timeout, or the browser blocking the call (CORS) all look alike here.
      throw new UpstreamDegraded(`network error: ${e instanceof Error ? e.name : "unknown"}`);
    } finally {
      clearTimeout(timer);
      this.ledger?.(path, status, Math.round(performance.now() - t0));
    }
    if (status === 429) {
      const ra = r.headers.get("retry-after");
      throw new QuotaExceeded(ra && /^\d+$/.test(ra) ? Number(ra) : null);
    }
    if (status === 401 || status === 403) throw new ProviderError("API key rejected", "auth_error", status);
    if (status >= 500) throw new UpstreamDegraded(`upstream ${status}`);
    if (status !== 200) throw new ProviderError(`upstream ${status}`, "upstream_error", status);
    let body: unknown;
    try { body = await r.json(); } catch { throw new ProviderError("bad upstream payload", "upstream_error"); }
    if (!isObj(body)) throw new ProviderError("bad upstream payload", "upstream_error");
    if (body.success === false) throw new ProviderError("upstream reported failure", "upstream_error");
    return isObj(body.data) ? body.data : {};
  }

  async getLiveRun(number: string, start: DateStr): Promise<LiveRun> {
    return mapLive(number, start, await this.get(`/trains/${number}/live`, { date: start }));
  }

  async getStationBoard(code: string, hoursAhead: number): Promise<StationBoard> {
    const hours = [2, 4, 6, 8].find((h) => h >= hoursAhead) ?? 8;
    return mapBoard(code, await this.get(`/stations/${code}/live`, { hours }));
  }
}
