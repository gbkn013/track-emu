// Deterministic builders for offline tests (no I/O, explicit clock).
import type { BoardEntry, LiveRun, RouteStop, StationBoard, TrainSchedule } from "./domain";
import { newLiveRun } from "./domain";
import { combineIst, type DateStr } from "./time";

export const DAY: DateStr = "2026-09-21"; // a Monday

/** Instant on IST date 2026-09-`day` at h:mi. */
export const at = (h: number, mi: number, day = 21) => combineIst(`2026-09-${String(day).padStart(2, "0")}`, h * 60 + mi);

/** stops: [code, arrOffsetMin, depOffsetMin] */
export function makeSchedule(
  stops: [string, number | null, number | null][],
  o: { number?: string; name?: string; originDepMin?: number; kind?: "EMU" | "MEMU" } = {},
): TrainSchedule {
  return {
    number: o.number ?? "43501",
    name: o.name ?? "Chennai Beach - Chengalpattu EMU",
    kind: o.kind ?? "EMU",
    source: stops[0][0],
    destination: stops[stops.length - 1][0],
    originDepMin: o.originDepMin ?? 330,
    stops: stops.map(([code, arr, dep], seq) => ({ seq, station_code: code, arr_offset_min: arr, dep_offset_min: dep })),
  };
}

export const makeLive = (number: string, o: Partial<LiveRun> = {}, route: RouteStop[] = []) =>
  newLiveRun(number, DAY, { is_live: true, route, ...o });

export function schedules(): TrainSchedule[] {
  return [
    // Fast: MSB 05:30 -> TBM(+50) -> CGL(+100)
    makeSchedule([["MSB", null, 0], ["TBM", 50, 51], ["CGL", 100, null]], { number: "40001", originDepMin: 330 }),
    // Reverse direction: CGL 06:00 -> TBM -> MSB
    makeSchedule([["CGL", null, 0], ["TBM", 50, 51], ["MSB", 100, null]], { number: "40002", originDepMin: 360 }),
    // Skips TBM
    makeSchedule([["MSB", null, 0], ["CGL", 80, null]], { number: "40003", originDepMin: 340 }),
    // Midnight crosser: MAS 23:40 -> TRT 00:25 (+45)
    makeSchedule([["MAS", null, 0], ["TRT", 45, null]], { number: "43501", originDepMin: 23 * 60 + 40, kind: "MEMU" }),
  ];
}

export function testCatalogueRaw() {
  return {
    source: "test",
    stations: ["MSB", "TBM", "CGL", "MAS", "TRT"].map((code) => ({ code, name: code, lat: 13, lng: 80 })),
    trains: schedules().map((s) => ({
      number: s.number, name: s.name, kind: s.kind, origin_dep_min: s.originDepMin,
      stops: s.stops.map((x) => ({ code: x.station_code, arr: x.arr_offset_min, dep: x.dep_offset_min })),
    })),
  };
}

export function board(entries: BoardEntry[]): StationBoard {
  return { code: "X", entries };
}
