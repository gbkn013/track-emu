// Query service (AGENTS.md §6.3–6.5) — port of backend/app/services/queries.py.
// Schedule-first: every answer is computable from the bundled timetable alone; a live overlay
// (when the visitor supplied a key, within budget, and fresh) upgrades individual ETAs. Live
// values are never fabricated; failures degrade to data_mode="scheduled".
import type { BoardResponse, BoardRow, Journey, JourneysResponse, Line, Meta, Station, StopRow, TrainBrief, TrainLive } from "../api";
import { Catalogue } from "./catalogue";
import { config } from "./config";
import type { DataMode, LiveRun, RouteStop, StationBoard, TrainSchedule } from "./domain";
import { newLiveRun } from "./domain";
import {
  computeRunEta, journeyBetween, stopOf, type JourneyResult, type RunEta, type StopEta,
} from "./engine";
import { ApiError } from "./errors";
import { LiveCache } from "./livecache";
import { QuotaLedger } from "./quota";
import type { LiveProvider } from "./railradar";
import { addDays, ageSeconds, combineIst, isoIst, istDate, MIN, type DateStr } from "./time";

export const TIMETABLE_NOTE =
  "Timetable from the open datameet dataset (~2016). Run days are unknown, so trains are " +
  "assumed to run daily; times and services may be out of date.";

const TRAIN_RE = /^\d{5}$/;
const CODE_RE = /^[A-Z0-9]{1,6}$/;
const BOARD_MATCH_TOLERANCE = 20 * MIN;

/** Re-key upstream route rows to the schedule's seq by station code, dropping unknown stations. */
export function alignLive(live: LiveRun, schedule: TrainSchedule): LiveRun {
  const seqOf = new Map<string, number>();
  for (const st of schedule.stops) if (!seqOf.has(st.station_code)) seqOf.set(st.station_code, st.seq);
  const rows: RouteStop[] = [];
  const seen = new Set<number>();
  for (const r of live.route) {
    const seq = seqOf.get(r.station_code);
    if (seq === undefined || seen.has(seq)) continue;
    seen.add(seq);
    rows.push({ ...r, seq });
  }
  return { ...live, route: rows };
}

/** A board row is per (train, time); require the expected time to be near ours so the other side
 *  of midnight's run of the same number isn't matched. */
function boardMatches(e: { expected_departure_time: number | null; delay_minutes: number | null }, scheduled: number): boolean {
  if (e.expected_departure_time === null || e.delay_minutes === null) return true;
  return Math.abs(e.expected_departure_time - (scheduled + e.delay_minutes * MIN)) <= BOARD_MATCH_TOLERANCE;
}

type Cand = { sch: TrainSchedule; d: DateStr; run: RunEta; j: JourneyResult };

export class QueryService {
  cache: LiveCache;

  constructor(
    public cat: Catalogue,
    public live: LiveProvider | null = null,
    public ledger: QuotaLedger = new QuotaLedger(),
    private opts = {
      stationBoardTtlS: config.stationBoardTtlS, trainLiveTtlS: config.trainLiveTtlS,
      staleAfterSeconds: config.staleAfterSeconds, maxStaleSeconds: config.maxStaleSeconds,
    },
  ) {
    this.cache = new LiveCache(opts.maxStaleSeconds);
  }

  // -- helpers -------------------------------------------------------------------------------

  liveEnabled(): boolean {
    return this.live !== null && this.ledger.state() !== "exhausted";
  }

  private ttl(base: number): number {
    return base * (this.ledger.state() === "stretch" ? 3 : 1);
  }

  private meta(now: number, liveUsed: boolean, stale: number | null): Meta {
    return {
      data_mode: "scheduled",
      fetched_at: isoIst(now),
      source: `datameet timetable${liveUsed ? " + railradar live" : ""}`,
      stale_seconds: stale,
      timetable_note: TIMETABLE_NOTE,
      live_configured: this.liveEnabled(),
    };
  }

  /** Journey dates that can still be running now: yesterday (midnight rollover) + today. */
  runDates(now: number): [DateStr, DateStr] {
    const d = istDate(now);
    return [addDays(d, -1), d];
  }

  private eta(sch: TrainSchedule, live: LiveRun | null, now: number, d: DateStr): RunEta {
    return computeRunEta(sch, live, now, { startDate: d, staleAfterSeconds: this.opts.staleAfterSeconds });
  }

  // -- validation (the API's edge checks) ----------------------------------------------------

  checkTrain(number: string): string {
    if (!TRAIN_RE.test(number)) throw new ApiError(422, "bad_train_number", "train number must be 5 digits");
    if (!this.cat.schedules.has(number)) throw new ApiError(404, "train_not_found", `unknown train ${number}`);
    return number;
  }

  checkStation(code: string): string {
    code = code.toUpperCase();
    if (!CODE_RE.test(code)) throw new ApiError(422, "bad_station_code", "invalid station code");
    if (!this.cat.byStation.has(code)) throw new ApiError(404, "station_not_found", `unknown station ${code}`);
    return code;
  }

  // -- catalogue -----------------------------------------------------------------------------

  searchStations(q: string, limit = 15): { stations: Station[] } {
    const ql = q.trim().toLowerCase();
    const out = [...this.cat.stations.values()].filter(
      (s) => this.cat.byStation.has(s.code) && (!ql || s.name.toLowerCase().includes(ql) || ql === s.code.toLowerCase()),
    );
    out.sort((a, b) => {
      const pa = a.name.toLowerCase().startsWith(ql) ? 0 : 1;
      const pb = b.name.toLowerCase().startsWith(ql) ? 0 : 1;
      return pa - pb || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    return { stations: out.slice(0, limit).map(({ code, name, lat, lng }) => ({ code, name, lat, lng })) };
  }

  searchTrains(q: string, limit = 30): { trains: TrainBrief[] } {
    const ql = q.trim().toLowerCase();
    const out = [...this.cat.schedules.values()].filter((t) => !ql || t.number.includes(ql) || t.name.toLowerCase().includes(ql));
    out.sort((a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0));
    return { trains: out.slice(0, limit).map((t) => this.trainBrief(t)) };
  }

  private trainBrief(t: TrainSchedule): TrainBrief {
    return {
      number: t.number, name: t.name, kind: t.kind, from: t.source, to: t.destination,
      from_name: this.cat.stationName(t.source), to_name: this.cat.stationName(t.destination),
    };
  }

  private stopJson(s: StopEta): StopRow {
    const st = this.cat.stations.get(s.station_code);
    return {
      seq: s.seq, station_code: s.station_code, station_name: this.cat.stationName(s.station_code),
      scheduled: s.scheduled === null ? null : isoIst(s.scheduled), eta: isoIst(s.eta),
      eta_source: s.eta_source, delay_min: s.delay_min, confidence: s.confidence, state: s.state,
      stale: s.stale, estimated: s.estimated, platform: s.platform, lat: st?.lat ?? null, lng: st?.lng ?? null,
    };
  }

  trainSchedule(number: string, now: number): TrainBrief & { run_days_known: boolean; stops: StopRow[] } {
    const t = this.cat.schedules.get(this.checkTrain(number))!;
    const d = this.runDates(now)[1];
    const run = computeRunEta(t, null, combineIst(d, t.originDepMin) - 60 * MIN, { startDate: d });
    return { ...this.trainBrief(t), run_days_known: false, stops: run.stops.map((s) => this.stopJson(s)) };
  }

  // -- journeys ------------------------------------------------------------------------------

  async journeys(frm: string, to: string, now: number, o: { limit?: number; horizonH?: number; showDeparted?: boolean } = {}): Promise<JourneysResponse> {
    const { limit = 10, horizonH = 6, showDeparted = false } = o;
    let cands: Cand[] = [];
    const toSet = new Set(this.cat.byStation.get(to) ?? []);
    const common = [...new Set(this.cat.byStation.get(frm) ?? [])].filter((n) => toSet.has(n)).sort();
    for (const num of common) {
      const sch = this.cat.schedules.get(num)!;
      for (const d of this.runDates(now)) {
        const run = this.eta(sch, null, now, d);
        const j = journeyBetween(sch, run, frm, to, now);
        if (j) cands.push({ sch, d, run, j });
      }
    }
    cands = this.window(cands, now, horizonH, showDeparted);

    let liveUsed = false;
    let stale: number | null = null;
    // Board-first (§6.3.1): ONE shared call for station A covers every train.
    const board = await this.liveBoard(frm);
    if (board) {
      const byNum = new Map(board.board.entries.map((e) => [e.train_number, e]));
      cands.forEach((c, i) => {
        const e = byNum.get(c.sch.number);
        const aStop = stopOf(c.run, frm);
        if (!e || e.delay_minutes === null || !aStop || aStop.scheduled === null) return;
        if (!boardMatches(e, aStop.scheduled)) return;
        const live = newLiveRun(c.sch.number, c.d, {
          is_live: true, last_updated_at: board.fetched,
          route: [{ seq: aStop.seq, station_code: frm, delay_minutes: e.delay_minutes, platform: e.platform }],
        });
        const lrun = this.eta(c.sch, live, now, c.d);
        const lj = journeyBetween(c.sch, lrun, frm, to, now);
        if (lj) {
          cands[i] = { sch: c.sch, d: c.d, run: lrun, j: lj };
          liveUsed = true;
          stale = Math.max(stale ?? 0, ageSeconds(board.fetched, now));
        }
      });
    }
    cands = this.window(cands, now, horizonH, showDeparted).slice(0, limit);

    const modes = new Set(cands.map((c) => c.j.data_mode));
    const mode: DataMode =
      modes.size === 1 && modes.has("live") ? "live" : [...modes].every((m) => m === "scheduled") ? "scheduled" : "partial";
    return {
      ...this.meta(now, liveUsed, stale), data_mode: mode, from: frm, to,
      journeys: cands.map((c) => this.journeyJson(c.sch, c.d, c.j)),
    };
  }

  private window(cands: Cand[], now: number, horizonH: number, showDeparted: boolean): Cand[] {
    const end = now + horizonH * 60 * MIN;
    const start = now - (showDeparted ? 60 : 10) * MIN;
    return cands
      .filter((c) => c.j.eta_at_a >= start && c.j.eta_at_a <= end && (showDeparted || c.j.state_relative_to_a !== "departed"))
      .sort((a, b) => a.j.eta_at_a - b.j.eta_at_a);
  }

  private journeyJson(sch: TrainSchedule, d: DateStr, j: JourneyResult): Journey {
    return {
      number: j.number, name: j.name, kind: sch.kind, start_date: d,
      eta_at_a: isoIst(j.eta_at_a), eta_at_b: isoIst(j.eta_at_b), expected_ride_min: j.expected_ride_min,
      delay_at_a: j.delay_at_a, state_relative_to_a: j.state_relative_to_a, platform_at_a: j.platform_at_a,
      source_at_a: j.source_at_a, source_at_b: j.source_at_b, data_mode: j.data_mode,
      to_name: this.cat.stationName(sch.destination),
    };
  }

  // -- train detail --------------------------------------------------------------------------

  activeDate(sch: TrainSchedule, now: number): DateStr {
    for (const d of this.runDates(now)) {
      const run = this.eta(sch, null, now, d);
      const last = run.stops[run.stops.length - 1];
      if (last && combineIst(d, sch.originDepMin) - 30 * MIN <= now && now <= last.eta + 30 * MIN) return d;
    }
    return istDate(now);
  }

  private async liveRun(sch: TrainSchedule, start: DateStr): Promise<{ live: LiveRun; age: number } | null> {
    const lp = this.live;
    if (!lp || !this.liveEnabled()) return null;
    const c = await this.cache.get(`live:${sch.number}:${start}`, this.ttl(this.opts.trainLiveTtlS), () => lp.getLiveRun(sch.number, start));
    return c ? { live: alignLive(c.value, sch), age: this.cache.ageS(c) } : null;
  }

  async trainLive(number: string, now: number, on?: DateStr): Promise<TrainLive> {
    const sch = this.cat.schedules.get(this.checkTrain(number))!;
    const d = on ?? this.activeDate(sch, now);
    const res = await this.liveRun(sch, d);
    const run = this.eta(sch, res?.live ?? null, now, d);
    const stale = res ? run.stale_seconds : null;
    return {
      ...this.trainBrief(sch),
      ...this.meta(now, res !== null, stale),
      data_mode: run.data_mode,
      start_date: d,
      position: { ...run.position, kind: run.position.kind },
      stops: run.stops.map((s) => this.stopJson(s)),
      exceptions: run.exceptions.map((e) => ({ type: e.type })),
    };
  }

  /** Straight polyline through station coordinates (the extract has no track geometry). */
  routeGeometry(number: string): Line {
    const sch = this.cat.schedules.get(this.checkTrain(number))!;
    const coordinates: [number, number][] = [];
    for (const s of sch.stops) {
      const st = this.cat.stations.get(s.station_code);
      if (st && st.lat !== null && st.lng !== null) coordinates.push([st.lng, st.lat]);
    }
    return { type: "LineString", coordinates };
  }

  // -- station board -------------------------------------------------------------------------

  async board(code: string, now: number, hours = 2): Promise<BoardResponse> {
    if (![2, 4, 6, 8].includes(hours)) throw new ApiError(422, "bad_hours", "hours must be 2, 4, 6 or 8");
    code = this.checkStation(code);
    type Row = BoardRow & { sched: number; etaMs: number };
    const rows: Row[] = [];
    for (const num of new Set(this.cat.byStation.get(code) ?? [])) {
      const sch = this.cat.schedules.get(num)!;
      for (const d of this.runDates(now)) {
        const st = stopOf(this.eta(sch, null, now, d), code);
        if (!st || st.scheduled === null || !(st.eta >= now - 15 * MIN && st.eta <= now + hours * 60 * MIN)) continue;
        rows.push({
          number: num, name: sch.name, start_date: d, to: sch.destination, to_name: this.cat.stationName(sch.destination),
          is_terminus: st.seq === sch.stops[sch.stops.length - 1].seq,
          scheduled: isoIst(st.scheduled), eta: isoIst(st.eta), delay_min: null, eta_source: "scheduled",
          platform: null, state: st.state, sched: st.scheduled, etaMs: st.eta,
        });
      }
    }
    let liveUsed = false;
    let stale: number | null = null;
    const board = await this.liveBoard(code);
    if (board) {
      const byNum = new Map(board.board.entries.map((e) => [e.train_number, e]));
      for (const r of rows) {
        const e = byNum.get(r.number);
        if (!e || e.delay_minutes === null || !boardMatches(e, r.sched)) continue;
        r.delay_min = e.delay_minutes;
        r.etaMs = r.sched + e.delay_minutes * MIN;
        r.eta = isoIst(r.etaMs);
        r.eta_source = "live_reported";
        r.platform = e.platform;
        liveUsed = true;
        stale = Math.max(stale ?? 0, ageSeconds(board.fetched, now));
      }
    }
    rows.sort((a, b) => a.etaMs - b.etaMs);
    return {
      ...this.meta(now, liveUsed, stale), data_mode: liveUsed ? "partial" : "scheduled",
      code, name: this.cat.stationName(code), hours,
      trains: rows.map((r) => ({ number: r.number, name: r.name, start_date: r.start_date, to: r.to, to_name: r.to_name, is_terminus: r.is_terminus, scheduled: r.scheduled, eta: r.eta, delay_min: r.delay_min, eta_source: r.eta_source, platform: r.platform, state: r.state })),
    };
  }

  /** Shared per-station board (always the widest window: one cache entry, one call). */
  private async liveBoard(code: string): Promise<{ board: StationBoard; age: number; fetched: number } | null> {
    const lp = this.live;
    if (!lp || !this.liveEnabled()) return null;
    const c = await this.cache.get(`board:${code}`, this.ttl(this.opts.stationBoardTtlS), () => lp.getStationBoard(code, 8));
    return c ? { board: c.value, age: this.cache.ageS(c), fetched: c.fetchedAt } : null;
  }

  // -- status --------------------------------------------------------------------------------

  status() {
    return {
      live_source: this.live?.name ?? "none",
      trains: this.cat.schedules.size,
      stations: this.cat.stations.size,
      quota: { used_this_month: this.ledger.usedThisMonth(), budget: config.monthlyRequestBudget, state: this.ledger.state() },
      cache: { hits: this.cache.hits, misses: this.cache.misses, breaker_open: this.cache.breakerOpen, last_error: this.cache.lastError },
    };
  }
}
