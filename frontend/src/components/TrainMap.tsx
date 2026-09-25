import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { Line, Position, StopRow } from "../api";
import { en } from "../i18n/en";

interface Props {
  line: Line; stops: StopRow[]; position: Position; timetableOnly: boolean; tileUrl?: string | null;
}

// Optional raster basemap from the server's TILE_SOURCE_URL (runtime config). Blank (route +
// stations only) by default so we never hotlink OSM's public tile servers (AGENTS.md §5).
// maplibre 6 ships its worker as a module importing a shared chunk; let Vite bundle it.
maplibregl.setWorkerUrl(workerUrl);

type LngLat = [number, number];

export function interpolate(a: LngLat, b: LngLat, t: number): LngLat {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/** Where to draw the train, or null when we can't place it honestly. */
export function markerPoint(position: Position, stops: StopRow[]): LngLat | null {
  const at = (code: string | null) => {
    const s = stops.find((x) => x.station_code === code);
    return s && s.lat !== null && s.lng !== null ? ([s.lng, s.lat] as LngLat) : null;
  };
  if (position.kind === "at_station") return at(position.station_code);
  if (position.kind !== "between" || position.progress === null) return null;
  const a = at(position.prev_station);
  const b = at(position.next_station);
  return a && b ? interpolate(a, b, position.progress) : null;
}

export default function TrainMap({ line, stops, position, timetableOnly, tileUrl }: Props) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const coords = line.coordinates as LngLat[];
    const style: maplibregl.StyleSpecification = {
      version: 8,
      sources: tileUrl ? { base: { type: "raster", tiles: [tileUrl], tileSize: 256 } } : {},
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#eef2f6" } },
        ...(tileUrl ? [{ id: "base", type: "raster" as const, source: "base" }] : []),
      ],
    };
    const map = new maplibregl.Map({ container: el.current, style, attributionControl: { compact: true } });
    map.on("load", () => {
      map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: line } });
      map.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#0b5cad", "line-width": 4 } });
      map.addSource("stops", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: stops.filter((s) => s.lat !== null && s.lng !== null).map((s) => ({
            type: "Feature" as const, properties: { name: s.station_name },
            geometry: { type: "Point" as const, coordinates: [s.lng as number, s.lat as number] },
          })),
        },
      });
      map.addLayer({
        id: "stops", type: "circle", source: "stops",
        paint: { "circle-radius": 4, "circle-color": "#fff", "circle-stroke-color": "#0b5cad", "circle-stroke-width": 2 },
      });
      const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
      map.fitBounds(bounds, { padding: 32, animate: false });
    });
    // Marker: dashed/hollow when it's a timetable estimate, solid only for instrumented positions.
    const pt = markerPoint(position, stops);
    let marker: maplibregl.Marker | null = null;
    if (pt) {
      const dot = document.createElement("div");
      dot.className = position.estimated || timetableOnly ? "train-marker train-marker-est" : "train-marker";
      dot.title = position.estimated || timetableOnly ? en.train.estMarker : "Train";
      marker = new maplibregl.Marker({ element: dot }).setLngLat(pt).addTo(map);
    }
    return () => { marker?.remove(); map.remove(); };
  }, [line, stops, position, timetableOnly, tileUrl]);
  return <div ref={el} className="map" role="img" aria-label={en.train.map} />;
}
