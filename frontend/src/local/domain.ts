// Provider-neutral domain types (mirror of backend/app/domain/models.py). Instants are epoch ms.
import type { DateStr } from "./time";

export type TrainKind = "EMU" | "MEMU" | "MRTS" | "OTHER";
export type RunStatus = "scheduled" | "running" | "completed" | "cancelled" | "partially_cancelled" | "diverted";
export type PositionKind = "not_started" | "at_station" | "between" | "terminated" | "cancelled" | "unknown";
export type EtaSource = "actual" | "live_reported" | "propagated" | "scheduled";
export type DataMode = "live" | "partial" | "scheduled";
export type Confidence = "high" | "medium" | "low";

export interface StationInfo { code: string; name: string; lat: number | null; lng: number | null }

export interface Stop {
  seq: number;
  station_code: string;
  arr_offset_min: number | null; // minutes after origin departure (null at the origin)
  dep_offset_min: number | null; // null at the terminus
}

export interface TrainSchedule {
  number: string;
  name: string;
  kind: TrainKind;
  source: string;
  destination: string;
  originDepMin: number; // minute of day (0..1439)
  stops: Stop[];
}

export interface CurrentLocation {
  station_code: string | null;
  status: string | null;
  is_actual_position: boolean;
  segment_progress: number | null;
  speed_kmh: number | null;
  bearing_degrees: number | null;
}

export interface RouteStop {
  seq: number;
  station_code: string;
  station_name?: string | null;
  status?: string | null;
  scheduled_arrival?: number | null;
  scheduled_departure?: number | null;
  actual_arrival?: number | null;
  actual_departure?: number | null;
  delay_minutes?: number | null;
  platform?: number | null;
}

export interface RunException { type: string; payload: Record<string, unknown> }

export interface LiveRun {
  number: string;
  start_date: DateStr;
  status: RunStatus;
  is_live: boolean;
  last_updated_at: number | null;
  delay_minutes: number | null;
  current_location: CurrentLocation | null;
  previous_halt: string | null;
  next_halt: string | null;
  route: RouteStop[];
  exceptions: RunException[];
}

export interface BoardEntry {
  train_number: string;
  train_name: string | null;
  live_type: string;
  expected_departure_time: number | null;
  delay_minutes: number | null;
  platform: number | null;
}
export interface StationBoard { code: string; entries: BoardEntry[] }

export function newLiveRun(number: string, start_date: DateStr, o: Partial<LiveRun> = {}): LiveRun {
  return {
    number, start_date, status: "running", is_live: false, last_updated_at: null, delay_minutes: null,
    current_location: null, previous_halt: null, next_halt: null, route: [], exceptions: [], ...o,
  };
}
