// Catalogue built from the committed datameet extract (CC0, ~2016): bundled with the app,
// so the whole timetable works with no server (see docs/decisions/0003-static-site.md).
import type { StationInfo, TrainKind, TrainSchedule } from "./domain";

export interface RawDataset {
  source: string;
  stations: { code: string; name: string; lat: number | null; lng: number | null }[];
  trains: {
    number: string; name: string; kind: string; origin_dep_min: number;
    stops: { code: string; arr: number | null; dep: number | null }[];
  }[];
}

export class Catalogue {
  schedules = new Map<string, TrainSchedule>();
  stations = new Map<string, StationInfo>();
  byStation = new Map<string, string[]>();

  static from(raw: RawDataset): Catalogue {
    const cat = new Catalogue();
    for (const s of raw.stations) cat.stations.set(s.code, { code: s.code, name: s.name, lat: s.lat, lng: s.lng });
    for (const t of raw.trains) {
      const sch: TrainSchedule = {
        number: t.number,
        name: t.name,
        kind: t.kind as TrainKind,
        source: t.stops[0].code,
        destination: t.stops[t.stops.length - 1].code,
        originDepMin: t.origin_dep_min % 1440,
        stops: t.stops.map((s, i) => ({ seq: i, station_code: s.code, arr_offset_min: s.arr, dep_offset_min: s.dep })),
      };
      cat.schedules.set(sch.number, sch);
      for (const st of sch.stops) {
        const l = cat.byStation.get(st.station_code) ?? [];
        if (!l.includes(sch.number)) l.push(sch.number);
        cat.byStation.set(st.station_code, l);
      }
    }
    return cat;
  }

  stationName(code: string): string {
    return this.stations.get(code)?.name ?? code;
  }
}

export async function loadCatalogue(): Promise<Catalogue> {
  // Lazy chunk: keeps first-paint JS within the bundle budget.
  const raw = (await import("../../../backend/app/data/datameet_tn.json")).default as RawDataset;
  return Catalogue.from(raw);
}
