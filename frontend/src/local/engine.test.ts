// ETA engine test matrix (AGENTS.md §9 required cases + §6.4 guarantees) — port of
// backend/tests/eta/test_engine.py. Offline and deterministic: `now` is always explicit.
import { describe, expect, it } from "vitest";
import { computeRunEta, journeyBetween, STATE_UPCOMING, stopOf } from "./engine";
import { at, DAY, makeLive, makeSchedule } from "./testkit";
import { combineIst, isoIst } from "./time";

// MSB 05:30 dep -> TBE 05:52 -> TBM 06:20 -> CGL 07:10 (terminus)
const SCHEDULE = makeSchedule([["MSB", null, 0], ["TBE", 22, 24], ["TBM", 50, 55], ["CGL", 100, null]], { originDepMin: 330 });
const opts = { startDate: DAY };
const S = (code: string, run: ReturnType<typeof computeRunEta>) => stopOf(run, code)!;

describe("schedule-only", () => {
  it("on time: every ETA equals its scheduled arrival, all labelled scheduled", () => {
    const run = computeRunEta(SCHEDULE, null, at(8, 0), opts);
    expect(run.data_mode).toBe("scheduled");
    for (const s of run.stops) { expect(s.eta_source).toBe("scheduled"); expect(s.eta).toBe(s.scheduled); }
    expect(S("CGL", run).eta).toBe(at(7, 10));
  });

  it("not started", () => {
    const run = computeRunEta(SCHEDULE, null, at(5, 0), opts);
    expect(run.position.kind).toBe("not_started");
  });

  it("never shows live, never fabricates a zero delay", () => {
    const run = computeRunEta(SCHEDULE, null, at(5, 0), opts);
    expect(run.data_mode).toBe("scheduled");
    expect(run.stops.every((s) => s.delay_min === null && !s.estimated)).toBe(true);
    const j = journeyBetween(SCHEDULE, run, "MSB", "TBM")!;
    expect(j.delay_at_a).toBeNull();
  });

  it("position is interpolated and flagged estimated", () => {
    const p = computeRunEta(SCHEDULE, null, at(5, 41), opts).position;
    expect(p.kind).toBe("between");
    expect(p.estimated).toBe(true);
    expect([p.prev_station, p.next_station]).toEqual(["MSB", "TBE"]);
    expect(p.progress).toBeCloseTo(0.5);
  });

  it("outputs are real instants (IST-formatted with +05:30)", () => {
    const run = computeRunEta(SCHEDULE, null, at(6, 0), opts);
    expect(isoIst(run.stops[0].eta)).toMatch(/\+05:30$/);
  });
});

describe("live overlay", () => {
  const route = (rows: object[]) => rows as never;

  it("delayed train carries the delay forward as propagated", () => {
    const live = makeLive("43501", { last_updated_at: at(6, 7), previous_halt: "TBE", next_halt: "TBM" }, route([
      { seq: 0, station_code: "MSB", actual_departure: at(5, 30), scheduled_departure: at(5, 30) },
      { seq: 1, station_code: "TBE", actual_arrival: at(6, 4), actual_departure: at(6, 6), scheduled_arrival: at(5, 52), delay_minutes: 12 },
    ]));
    const run = computeRunEta(SCHEDULE, live, at(6, 8), opts);
    expect(S("TBE", run).eta_source).toBe("actual");
    expect(S("TBE", run).eta).toBe(at(6, 4));
    const tbm = S("TBM", run);
    expect(tbm.eta_source).toBe("propagated");
    expect(tbm.eta).toBe(at(6, 32));
    expect(tbm.delay_min).toBe(12);
    expect(tbm.estimated).toBe(true);
  });

  it("recovery reduces the carried delay", () => {
    const live = makeLive("43501", { last_updated_at: at(6, 7) }, route([
      { seq: 1, station_code: "TBE", actual_arrival: at(6, 4), scheduled_arrival: at(5, 52), delay_minutes: 12 },
    ]));
    const run = computeRunEta(SCHEDULE, live, at(6, 8), { ...opts, recoveryMinPerSegment: 5 });
    expect(S("TBM", run).eta).toBe(at(6, 27));
    expect(S("TBM", run).delay_min).toBe(7);
  });

  it("an ETA never precedes the last actual", () => {
    const live = makeLive("43501", { last_updated_at: at(6, 41) }, route([
      { seq: 1, station_code: "TBE", actual_arrival: at(6, 40), scheduled_arrival: at(5, 52), delay_minutes: 48 },
      { seq: 2, station_code: "TBM", delay_minutes: 5 },
    ]));
    const run = computeRunEta(SCHEDULE, live, at(6, 45), opts);
    expect(S("TBM", run).eta).toBeGreaterThanOrEqual(S("TBE", run).eta);
  });

  it("ETAs are non-decreasing across stops even with an impossible early report", () => {
    const live = makeLive("43501", { last_updated_at: at(6, 0) }, route([
      { seq: 0, station_code: "MSB", actual_departure: at(5, 30) },
      { seq: 2, station_code: "TBM", delay_minutes: -30 },
    ]));
    const etas = computeRunEta(SCHEDULE, live, at(6, 10), opts).stops.map((s) => s.eta);
    expect(etas).toEqual([...etas].sort((a, b) => a - b));
  });

  it("stale snapshot downgrades confidence", () => {
    const live = makeLive("43501", { last_updated_at: at(5, 30) }, route([
      { seq: 1, station_code: "TBE", actual_arrival: at(5, 52), delay_minutes: 0 },
    ]));
    const run = computeRunEta(SCHEDULE, live, at(6, 0), opts);
    expect(S("TBE", run).stale).toBe(true);
    expect(S("TBE", run).confidence).toBe("medium");
    expect(run.stale_seconds).toBeGreaterThan(300);
  });

  it("missing actual fields fall back to scheduled", () => {
    const live = makeLive("43501", { last_updated_at: at(6, 0) }, route([
      { seq: 1, station_code: "TBE", scheduled_arrival: at(5, 52) },
    ]));
    const run = computeRunEta(SCHEDULE, live, at(6, 10), opts);
    expect(S("TBE", run).eta_source).toBe("scheduled");
    expect(["scheduled", "partial"]).toContain(run.data_mode);
  });

  it("cancelled run", () => {
    const live = makeLive("43501", { status: "cancelled", last_updated_at: at(6, 0) });
    expect(computeRunEta(SCHEDULE, live, at(6, 10), opts).position.kind).toBe("cancelled");
  });

  it("real instrumented position reports progress", () => {
    const live = makeLive("43501", {
      last_updated_at: at(6, 5), previous_halt: "TBE", next_halt: "TBM",
      current_location: { station_code: null, status: null, is_actual_position: true, segment_progress: 0.4, speed_kmh: 42, bearing_degrees: 120 },
    }, route([{ seq: 1, station_code: "TBE", actual_departure: at(6, 0), delay_minutes: 2 }]));
    const p = computeRunEta(SCHEDULE, live, at(6, 6), opts).position;
    expect(p.kind).toBe("between");
    expect([p.prev_station, p.next_station]).toEqual(["TBE", "TBM"]);
    expect(p.progress).toBeCloseTo(0.4);
    expect(p.estimated).toBe(false);
  });

  it("never fabricates progress without isActualPosition", () => {
    const live = makeLive("43501", {
      last_updated_at: at(6, 5), previous_halt: "TBE", next_halt: "TBM",
      current_location: { station_code: "TBE", status: null, is_actual_position: false, segment_progress: null, speed_kmh: null, bearing_degrees: null },
    }, route([{ seq: 1, station_code: "TBE", actual_arrival: at(6, 4) }]));
    const p = computeRunEta(SCHEDULE, live, at(6, 6), opts).position;
    if (p.kind === "between") { expect(p.progress).toBeNull(); expect(p.estimated).toBe(true); }
  });

  it("propagation applies without a route row for the stop (upstream lists only visited stops)", () => {
    const live = makeLive("43501", { last_updated_at: at(6, 5) }, route([
      { seq: 1, station_code: "TBE", actual_arrival: at(6, 4), scheduled_arrival: at(5, 52), delay_minutes: 12 },
    ]));
    const cgl = S("CGL", computeRunEta(SCHEDULE, live, at(6, 6), opts));
    expect(cgl.eta_source).toBe("propagated");
    expect(cgl.eta).toBe(at(7, 22));
  });

  it("a reported delay without actuals (station board) propagates forward, not backward", () => {
    const live = makeLive("43501", { last_updated_at: at(5, 45) }, route([{ seq: 1, station_code: "TBE", delay_minutes: 9 }]));
    const run = computeRunEta(SCHEDULE, live, at(5, 46), opts);
    expect(S("TBE", run).eta_source).toBe("live_reported");
    expect(S("TBM", run).eta_source).toBe("propagated");
    expect(S("TBM", run).eta).toBe(at(6, 29));
    expect(S("MSB", run).eta_source).toBe("scheduled");
  });
});

describe("midnight and journeys", () => {
  it("a 23:40 start reaches its terminus at 00:25 on the next calendar day", () => {
    const sched = makeSchedule([["MAS", null, 0], ["TRT", 45, null]], { number: "42564", originDepMin: 23 * 60 + 40, kind: "MEMU" });
    const run = computeRunEta(sched, null, at(23, 50), opts);
    expect(S("TRT", run).eta).toBe(at(0, 25, 22));
    expect(S("TRT", run).eta).toBeGreaterThan(S("MAS", run).eta);
  });

  it("selects halts and direction", () => {
    const now = at(6, 0);
    const run = computeRunEta(SCHEDULE, null, now, opts);
    const j = journeyBetween(SCHEDULE, run, "TBM", "CGL", now)!;
    expect(j.eta_at_a).toBe(S("TBM", run).eta);
    expect(j.eta_at_b).toBe(S("CGL", run).eta);
    expect(j.expected_ride_min).toBe(50);
    expect(j.state_relative_to_a).toBe(STATE_UPCOMING);
    expect(journeyBetween(SCHEDULE, run, "CGL", "TBM", now)).toBeNull(); // wrong direction
    expect(journeyBetween(SCHEDULE, run, "AVD", "CGL", now)).toBeNull(); // A not a halt
  });

  it("the origin stop is a valid journey start", () => {
    const run = computeRunEta(SCHEDULE, null, at(5, 0), opts);
    expect(S("MSB", run).eta).toBe(at(5, 30));
    expect(journeyBetween(SCHEDULE, run, "MSB", "TBM")!.expected_ride_min).toBe(50);
  });

  it("combineIst is exact (06:00 IST == 00:30 UTC)", () => {
    expect(new Date(combineIst(DAY, 360)).toISOString()).toBe("2026-09-21T00:30:00.000Z");
  });
});
