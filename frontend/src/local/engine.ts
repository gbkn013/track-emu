// Pure ETA engine (AGENTS.md §6.4) — a line-for-line port of backend/app/eta/engine.py.
// Guarantees: ETAs are monotonic across stops; never precede the last recorded actual; a scheduled
// time is never upgraded to look live; progress is real only when upstream says so. No I/O and no
// Date.now(): `now` is always a parameter.
import type {
  Confidence, DataMode, EtaSource, LiveRun, PositionKind, RouteStop, RunException, Stop, TrainSchedule,
} from "./domain";
import { ageSeconds, combineIst, MIN, pyRound, type DateStr } from "./time";

export const STATE_UPCOMING = "upcoming";
export const STATE_ARRIVING = "arriving";
export const STATE_AT_STATION = "at_station";
export const STATE_DEPARTED = "departed";
export const STATE_SKIPPED = "skipped";

/** A stop within this many minutes of now counts as 'arriving'. */
export const ARRIVING_WINDOW_MIN = 10;

export interface StopEta {
  seq: number;
  station_code: string;
  eta: number;
  eta_source: EtaSource;
  delay_min: number | null;
  confidence: Confidence;
  state: string;
  stale: boolean;
  estimated: boolean;
  scheduled: number | null;
  platform: number | null;
}

export interface Position {
  kind: PositionKind;
  station_code: string | null;
  prev_station: string | null;
  next_station: string | null;
  progress: number | null;
  estimated: boolean;
}

const pos = (kind: PositionKind, o: Partial<Position> = {}): Position => ({
  kind, station_code: null, prev_station: null, next_station: null, progress: null, estimated: false, ...o,
});

export interface RunEta {
  number: string;
  start_date: DateStr;
  computed_at: number;
  data_mode: DataMode;
  position: Position;
  stops: StopEta[];
  stale_seconds: number | null;
  exceptions: RunException[];
}

export const stopOf = (run: RunEta, code: string): StopEta | undefined =>
  run.stops.find((s) => s.station_code === code);

export interface JourneyResult {
  number: string;
  name: string;
  eta_at_a: number;
  eta_at_b: number;
  expected_ride_min: number;
  delay_at_a: number | null;
  state_relative_to_a: string;
  platform_at_a: number | null;
  source_at_a: EtaSource;
  source_at_b: EtaSource;
  data_mode: DataMode;
}

// --- internals --------------------------------------------------------------------------------

/** Origin has no arrival: its departure stands in, so a rider boarding at the terminus still gets an ETA. */
function scheduledArrival(originDep: number, stop: Stop): number | null {
  const off = stop.arr_offset_min ?? stop.dep_offset_min;
  return off === null ? null : originDep + off * MIN;
}

const delayMin = (actual: number, scheduled: number) => pyRound((actual - scheduled) / MIN);

/** Most recent stop with a recorded actual: [time, delay, seq]. */
function lastActual(route: RouteStop[]): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  for (const rs of route) {
    const actual = rs.actual_departure ?? rs.actual_arrival ?? null;
    if (actual === null) continue;
    let d: number;
    if (rs.delay_minutes != null) d = rs.delay_minutes;
    else if (rs.actual_departure != null && rs.scheduled_departure != null) d = delayMin(rs.actual_departure, rs.scheduled_departure);
    else if (rs.actual_arrival != null && rs.scheduled_arrival != null) d = delayMin(rs.actual_arrival, rs.scheduled_arrival);
    else d = 0;
    if (best === null || actual > best[0] || (actual === best[0] && rs.seq > best[2])) best = [actual, d, rs.seq];
  }
  return best;
}

function positionFromLive(live: LiveRun, route: RouteStop[], originDep: number, now: number): Position {
  if (live.status === "cancelled") return pos("cancelled");
  const loc = live.current_location;
  if (loc && (loc.station_code || loc.segment_progress !== null)) {
    if (loc.station_code && loc.segment_progress === null) return pos("at_station", { station_code: loc.station_code });
    if (live.previous_halt && live.next_halt) {
      // Progress only when upstream asserts a real position (never invent one, §11).
      const real = loc.is_actual_position && loc.segment_progress !== null;
      return pos("between", {
        prev_station: live.previous_halt, next_station: live.next_halt,
        progress: real ? loc.segment_progress : null, estimated: !real,
      });
    }
    if (loc.station_code) return pos("at_station", { station_code: loc.station_code });
  }
  const la = lastActual(route);
  if (la === null) return now < originDep ? pos("not_started") : pos("unknown");
  const nxt = route.find((rs) => rs.seq > la[2]);
  if (!nxt) return pos("terminated");
  return pos("between", { next_station: nxt.station_code, progress: null, estimated: true });
}

/** Where the run *should* be per the timetable — always flagged estimated. */
function positionFromTimetable(stops: StopEta[], now: number): Position {
  let prev: StopEta | null = null;
  for (const s of stops) {
    if (s.eta > now) {
      if (prev === null) return pos("not_started");
      const span = s.eta - prev.eta;
      return pos("between", {
        prev_station: prev.station_code, next_station: s.station_code,
        progress: span > 0 ? (now - prev.eta) / span : null, estimated: true,
      });
    }
    prev = s;
  }
  return pos("unknown");
}

function isStale(live: LiveRun | null, now: number, staleAfterSeconds: number): boolean {
  if (!live || live.last_updated_at === null) return false;
  return ageSeconds(live.last_updated_at, now) > staleAfterSeconds;
}

const DOWNGRADE: Record<Confidence, Confidence> = { high: "medium", medium: "low", low: "low" };
const BASE_CONF: Record<EtaSource, Confidence> = { actual: "high", live_reported: "high", propagated: "medium", scheduled: "low" };
const confidence = (source: EtaSource, stale: boolean): Confidence =>
  stale ? DOWNGRADE[BASE_CONF[source]] : BASE_CONF[source];

function stateFor(eta: number, now: number, rs: RouteStop | undefined): string {
  if (rs?.status && ["skipped", "no-halt", "terminated"].includes(rs.status.toLowerCase())) return STATE_SKIPPED;
  if (rs && (rs.actual_arrival != null || rs.actual_departure != null)) {
    return rs.actual_departure != null || now > eta ? STATE_DEPARTED : STATE_ARRIVING;
  }
  const deltaMin = (eta - now) / MIN;
  if (deltaMin < -ARRIVING_WINDOW_MIN) return STATE_DEPARTED;
  if (deltaMin <= ARRIVING_WINDOW_MIN) return STATE_ARRIVING;
  return STATE_UPCOMING;
}

function dataMode(live: LiveRun, now: number, staleAfterSeconds: number, stops: StopEta[]): DataMode {
  if (!live.is_live || stops.length === 0) return "scheduled";
  const reported = stops.filter((s) => s.eta_source === "actual" || s.eta_source === "live_reported");
  if (reported.length > 0 && !isStale(live, now, staleAfterSeconds) && reported.length === stops.length) return "live";
  return "partial";
}

// --- public API -------------------------------------------------------------------------------

export interface EtaOptions { startDate?: DateStr; staleAfterSeconds?: number; recoveryMinPerSegment?: number }

export function computeRunEta(schedule: TrainSchedule, live: LiveRun | null, now: number, opts: EtaOptions = {}): RunEta {
  const staleAfter = opts.staleAfterSeconds ?? 300;
  const recovery = opts.recoveryMinPerSegment ?? 0;
  const sdate = opts.startDate ?? live?.start_date;
  if (!sdate) throw new Error("computeRunEta needs a start date");
  const originDep = combineIst(sdate, schedule.originDepMin);

  const routeBySeq = new Map<number, RouteStop>((live?.route ?? []).map((r) => [r.seq, r]));
  const la = live ? lastActual(live.route) : null;
  const stale = isStale(live, now, staleAfter);

  const lastActualSeq = la ? la[2] : null;
  const lastActualTime = la ? la[0] : null;
  // Propagation anchor: last recorded actual, else (station-board data: a delay but no actual)
  // the furthest stop with an upstream-reported delay.
  let anchorDelay: number | null = la ? la[1] : null;
  let anchorSeq: number | null = lastActualSeq;
  if (la === null && live) {
    const reported = live.route.filter((r) => r.delay_minutes != null);
    if (reported.length) {
      const far = reported.reduce((a, b) => (b.seq > a.seq ? b : a));
      anchorDelay = far.delay_minutes ?? null;
      anchorSeq = far.seq;
    }
  }

  const stops: StopEta[] = [];
  let prevEta: number | null = null;
  for (const stop of [...schedule.stops].sort((a, b) => a.seq - b.seq)) {
    const sched = scheduledArrival(originDep, stop);
    if (sched === null) continue;
    const rs = routeBySeq.get(stop.seq);

    let source: EtaSource = "scheduled";
    let eta = sched;
    let estimated = false;

    // The origin has no arrival: its recorded departure is its actual.
    let recorded = rs?.actual_arrival ?? null;
    if (rs && recorded === null && stop.arr_offset_min === null) recorded = rs.actual_departure ?? null;
    if (rs && recorded !== null) {
      eta = recorded;
      source = "actual";
    } else if (rs && rs.delay_minutes != null) {
      eta = sched + rs.delay_minutes * MIN;
      source = "live_reported";
    } else if (anchorDelay !== null && anchorSeq !== null && stop.seq > anchorSeq) {
      // Carry the last known delay forward (applies even when route[] has no row for this stop).
      const segs = stop.seq - anchorSeq;
      const recovered = Math.min(recovery * segs, Math.max(0, anchorDelay));
      eta = sched + (anchorDelay - recovered) * MIN;
      source = "propagated";
      estimated = true;
    }

    // Constraint 1: never precede the last recorded actual time.
    if (source !== "actual" && lastActualTime !== null && lastActualSeq !== null && stop.seq > lastActualSeq && eta < lastActualTime) {
      eta = lastActualTime;
      if (source === "scheduled") { source = "propagated"; estimated = true; }
    }
    // Constraint 2: monotonic non-decreasing across stops.
    if (prevEta !== null && eta < prevEta) {
      eta = prevEta;
      if (source === "scheduled") { source = "propagated"; estimated = true; }
    }
    prevEta = eta;

    stops.push({
      seq: stop.seq,
      station_code: stop.station_code,
      eta,
      eta_source: source,
      // A purely scheduled ETA has no derivable delay: null, never a fabricated 0.
      delay_min: source === "scheduled" ? null : pyRound((eta - sched) / MIN),
      confidence: confidence(source, stale),
      state: stateFor(eta, now, rs),
      stale,
      estimated,
      scheduled: sched,
      platform: rs?.platform ?? null,
    });
  }

  let position: Position;
  let mode: DataMode;
  if (live === null) {
    if (now < originDep) position = pos("not_started");
    else if (stops.length && now > stops[stops.length - 1].eta) position = pos("terminated");
    else position = positionFromTimetable(stops, now);
    mode = "scheduled";
  } else if (live.status === "cancelled") {
    position = pos("cancelled");
    mode = "scheduled";
  } else {
    position = positionFromLive(live, live.route, originDep, now);
    mode = dataMode(live, now, staleAfter, stops);
  }

  return {
    number: schedule.number,
    start_date: sdate,
    computed_at: now,
    data_mode: mode,
    position,
    stops,
    stale_seconds: live && live.last_updated_at !== null ? ageSeconds(live.last_updated_at, now) : null,
    exceptions: live ? live.exceptions : [],
  };
}

/** A→B result for one train, or null if it doesn't halt at both stations with A before B. */
export function journeyBetween(schedule: TrainSchedule, run: RunEta, from: string, to: string, now?: number): JourneyResult | null {
  const a = stopOf(run, from);
  const b = stopOf(run, to);
  if (!a || !b || a.seq >= b.seq) return null;
  const t = now ?? run.computed_at;

  const deltaA = (a.eta - t) / 1000;
  let stateA: string;
  if (a.eta_source === "actual" && (a.state === STATE_DEPARTED || a.state === STATE_AT_STATION)) stateA = a.state;
  else if (deltaA < 0) stateA = deltaA < -ARRIVING_WINDOW_MIN * 60 ? STATE_DEPARTED : STATE_AT_STATION;
  else stateA = deltaA <= ARRIVING_WINDOW_MIN * 60 ? STATE_ARRIVING : STATE_UPCOMING;

  return {
    number: run.number,
    name: schedule.name,
    eta_at_a: a.eta,
    eta_at_b: b.eta,
    expected_ride_min: pyRound((b.eta - a.eta) / MIN),
    delay_at_a: a.delay_min,
    state_relative_to_a: stateA,
    platform_at_a: a.platform,
    source_at_a: a.eta_source,
    source_at_b: b.eta_source,
    data_mode: run.data_mode,
  };
}
