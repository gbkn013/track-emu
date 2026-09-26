import { useQuery } from "@tanstack/react-query";
import { Fragment, lazy, Suspense } from "react";
import { api, type Position, type StopRow } from "../api";
import { en } from "../i18n/en";
import { dayHeading, delayText, hhmm, istDay } from "../format";
import { DelayChip, ErrorBox, Freshness, SourceBadge } from "./Common";
import { ScreenHeader } from "./ScreenHeader";

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

interface Props { number: string; from?: string; to?: string }

/** Running status of one train: where it is, the map, and a stop-by-stop timeline. */
export function TrainDetail({ number, from, to }: Props) {
  const q = useQuery({ queryKey: ["train", number], queryFn: () => api.trainLive(number), refetchInterval: 60_000 });
  const cfg = useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
  const route = useQuery({ queryKey: ["route", number], queryFn: () => api.route(number), staleTime: 86_400_000 });
  const back = from && to ? `#/trip/${from}/${to}` : "#/";

  if (q.isPending) {
    return (
      <>
        <ScreenHeader title={`Train ${number}`} backHref={back} />
        <div className="main" role="status" aria-label={en.loading}>
          <div className="card pad"><div className="skeleton sk-line" /><div className="skeleton sk-line" /></div>
        </div>
      </>
    );
  }
  if (q.isError) {
    return (
      <>
        <ScreenHeader title={`Train ${number}`} backHref={back} />
        <div className="main"><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>
      </>
    );
  }
  const d = q.data;
  const timetableOnly = d.data_mode === "scheduled";
  const fromIdx = from ? d.stops.findIndex((s) => s.station_code === from) : -1;
  const toIdx = to ? d.stops.findIndex((s) => s.station_code === to) : -1;
  const hasSegment = fromIdx >= 0 && toIdx > fromIdx;
  const currentCode = d.position.kind === "at_station" ? d.position.station_code : null;

  return (
    <>
      <ScreenHeader
        backHref={back}
        title={d.name}
        subtitle={`${d.number} · ${d.kind} · ${d.from_name} → ${d.to_name}`}
      />
      <main className="main">
        <section className="card status" aria-live="polite">
          <p className="eyebrow">
            {!timetableOnly && <span className="live-dot" aria-hidden="true" />}
            {timetableOnly ? en.status.timetablePos : `${en.status.live} · ${d.source}`}
          </p>
          <p className="status-main">{positionSentence(d.position, d.stops)}</p>
          {d.position.estimated && d.position.kind === "between" && <p className="muted small">{en.train.estimatedNote}</p>}
          {d.exceptions.length > 0 && <p className="chip chip-bad">{d.exceptions.map((e) => e.type).join(", ")}</p>}
        </section>
        <Freshness meta={d} />

        <section aria-label={en.train.map} className="map-wrap">
          <Suspense fallback={<div className="map skeleton" />}>
            {route.data && route.data.coordinates.length > 1 ? (
              <TrainMap line={route.data} stops={d.stops} position={d.position} timetableOnly={timetableOnly} tileUrl={cfg.data?.tile_source_url} />
            ) : <div className="map map-empty">{en.train.mapUnavailable}</div>}
          </Suspense>
        </section>

        <h2 className="eyebrow">{en.train.stops}</h2>
        <ol className="tl card" aria-label={en.train.stops}>
          {d.stops.map((s, idx) => {
            const inSeg = !hasSegment || (idx >= fromIdx && idx <= toIdx);
            const isBoard = hasSegment && idx === fromIdx, isAlight = hasSegment && idx === toIdx;
            const isEnd = idx === 0 || idx === d.stops.length - 1;
            const passed = s.state === "departed";
            const current = s.station_code === currentCode;
            const prev = d.stops[idx - 1];
            const newDay = prev && istDay(s.eta) > istDay(prev.eta);
            const late = s.eta_source !== "scheduled" && s.scheduled && s.scheduled !== s.eta;
            return (
              <Fragment key={s.seq}>
                {newDay && <li aria-hidden="true" className="tl-day">{dayHeading(s.eta, Date.parse(s.eta))}</li>}
                <li className={`tl-item${inSeg ? "" : " tl-off"}`} aria-current={current ? "step" : undefined}>
                  <div className="tl-time">
                    <div className="tl-eta">{hhmm(s.eta)}</div>
                    {late && <div className="tl-sched">{en.status.sched(hhmm(s.scheduled))}</div>}
                  </div>
                  <div className="tl-rail" aria-hidden="true">
                    {idx < d.stops.length - 1 && <span className={`tl-line${passed ? " tl-line-done" : inSeg && hasSegment ? " tl-line-seg" : ""}`} />}
                    <span className={`tl-dot${isEnd || isBoard || isAlight || current ? " tl-dot-big" : ""}${current ? " tl-dot-now" : passed ? " tl-dot-done" : ""}`} />
                  </div>
                  <div className="tl-body">
                    <div className="tl-name">
                      <a className={isEnd || isBoard || isAlight ? "strong" : ""} href={`#/station/${s.station_code}`}>{s.station_name}</a>
                      <span className="code">{s.station_code}</span>
                      {isBoard && <span className="tag">{en.status.board}</span>}
                      {isAlight && <span className="tag">{en.status.getOff}</span>}
                      {current && <span className="tag tag-soft">{timetableOnly ? en.status.here : en.status.hereLive}</span>}
                    </div>
                    <div className="tl-chips">
                      <DelayChip delay={s.eta_source === "scheduled" ? null : s.delay_min} />
                      <SourceBadge source={s.eta_source} />
                      {s.platform ? <span className="muted small">{en.platform(s.platform)}</span> : null}
                    </div>
                  </div>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </main>
    </>
  );
}
