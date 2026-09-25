import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { api, type Position, type StopRow } from "../api";
import { en } from "../i18n/en";
import { delayText, hhmm } from "../format";
import { DelayChip, ErrorBox, Freshness, Loading, SourceBadge } from "./Common";

const TrainMap = lazy(() => import("./TrainMap"));

export function positionSentence(p: Position, stops: StopRow[]): string {
  const name = (c: string | null) => stops.find((s) => s.station_code === c)?.station_name ?? c ?? "?";
  const t = en.train;
  switch (p.kind) {
    case "not_started": return t.notStarted;
    case "terminated": return t.terminated;
    case "cancelled": return t.cancelled;
    case "at_station": return t.atStation(name(p.station_code));
    case "between": {
      const next = stops.find((s) => s.station_code === p.next_station);
      const base = p.prev_station
        ? t.between(name(p.prev_station), name(p.next_station))
        : `${t.between("?", name(p.next_station))}`.replace("?", "…");
      const tail = next ? ` — ${t.nextEta(next.station_name, hhmm(next.eta), next.delay_min === null ? "" : delayText(next.delay_min))}` : "";
      return base + tail;
    }
    default: return t.unknown;
  }
}

export function TrainDetail({ number }: { number: string }) {
  const q = useQuery({ queryKey: ["train", number], queryFn: () => api.trainLive(number), refetchInterval: 60_000 });
  const cfg = useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
  const route = useQuery({ queryKey: ["route", number], queryFn: () => api.route(number), staleTime: 86_400_000 });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const timetableOnly = d.data_mode === "scheduled";
  return (
    <article>
      <h1 className="h-train">{d.number} <small>{d.kind}</small></h1>
      <p className="muted">{d.name} · {d.from_name} → {d.to_name}</p>
      <Freshness meta={d} />
      <p className="position" aria-live="polite">
        {positionSentence(d.position, d.stops)}
        {d.position.estimated && d.position.kind === "between" && (
          <small className="muted"> ({en.train.estimatedNote})</small>
        )}
      </p>
      {d.exceptions.length > 0 && (
        <p className="chip chip-bad">{d.exceptions.map((e) => e.type).join(", ")}</p>
      )}
      <section aria-label={en.train.map}>
        <Suspense fallback={<div className="map skeleton" />}>
          {route.data && route.data.coordinates.length > 1 ? (
            <TrainMap line={route.data} stops={d.stops} position={d.position} timetableOnly={timetableOnly} tileUrl={cfg.data?.tile_source_url} />
          ) : <div className="map map-empty">{en.train.mapUnavailable}</div>}
        </Suspense>
      </section>
      <h2>{en.train.stops}</h2>
      <ol className="timeline">
        {d.stops.map((s) => (
          <li key={s.seq} className={`stop stop-${s.state}`}>
            <div className="stop-name">
              <a href={`#/station/${s.station_code}`}>{s.station_name}</a>
              {s.platform ? <small> · {en.platform(s.platform)}</small> : null}
            </div>
            <div className="stop-times">
              <span className="muted" title={en.train.schedVsExpected}>{hhmm(s.scheduled)}</span>
              <strong>{hhmm(s.eta)}</strong>
              <DelayChip delay={s.eta_source === "scheduled" ? null : s.delay_min} />
              <SourceBadge source={s.eta_source} />
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
