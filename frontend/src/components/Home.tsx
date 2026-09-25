import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Journey, type Station } from "../api";
import { en } from "../i18n/en";
import { delayText, hhmm } from "../format";
import type { RoutePair } from "../storage";
import { DelayChip, Empty, ErrorBox, Freshness, Loading, SourceBadge } from "./Common";
import { StationPicker } from "./StationPicker";

interface Props {
  saved: RoutePair[]; recent: RoutePair[];
  isSaved: (p: RoutePair) => boolean;
  toggleSaved: (p: RoutePair) => void; addRecent: (p: RoutePair) => void;
}

export function JourneyRow({ j }: { j: Journey }) {
  const a = j.source_at_a === "scheduled" ? null : j.delay_at_a;
  const live = j.source_at_a === "actual" || j.source_at_a === "live_reported";
  return (
    <li className="row">
      <a className="row-link" href={`#/train/${j.number}`}
        aria-label={`${j.name}, departs ${hhmm(j.eta_at_a)}${a === null ? "" : ", " + delayText(a)}`}>
        <div className="row-main">
          <span className="time-big">{hhmm(j.eta_at_a)}</span>
          <span className="arrow" aria-hidden="true">→</span>
          <span className="time-mid">{hhmm(j.eta_at_b)}</span>
          <DelayChip delay={a} />
        </div>
        <div className="row-sub">
          <span>{j.number} · {j.name}</span>
          <span>{en.ride(j.expected_ride_min)}{j.platform_at_a ? ` · ${en.platform(j.platform_at_a)}` : ""}</span>
        </div>
        <div className="row-badges">
          <SourceBadge source={j.source_at_a} />
          {(j.state_relative_to_a === "arriving" || j.state_relative_to_a === "at_station") && (
            <span className="chip chip-warn">{live ? en.state.arriving : en.state.dueNow}</span>
          )}
          {j.state_relative_to_a === "departed" && (
            <span className="chip chip-none">{live ? en.state.departed : en.state.dueEarlier}</span>
          )}
        </div>
      </a>
    </li>
  );
}

export function Home({ saved, recent, isSaved, toggleSaved, addRecent }: Props) {
  const [from, setFrom] = useState<Station | null>(null);
  const [to, setTo] = useState<Station | null>(null);
  const [showDeparted, setShowDeparted] = useState(false);
  const ready = !!from && !!to && from.code !== to.code;
  const q = useQuery({
    queryKey: ["journeys", from?.code, to?.code, showDeparted],
    queryFn: () => api.journeys(from!.code, to!.code, showDeparted),
    enabled: ready, refetchInterval: 60_000,
  });
  const pair: RoutePair | null = ready
    ? { from: from!.code, to: to!.code, fromName: from!.name, toName: to!.name } : null;
  const choose = (p: RoutePair) => {
    setFrom({ code: p.from, name: p.fromName, lat: null, lng: null });
    setTo({ code: p.to, name: p.toName, lat: null, lng: null });
    addRecent(p);
  };
  const chips = (title: string, list: RoutePair[]) => list.length > 0 && (
    <section aria-label={title}>
      <h2 className="h-small">{title}</h2>
      <div className="chips">
        {list.map((p) => (
          <button key={p.from + p.to} className="btn btn-chip" onClick={() => choose(p)}>
            {p.fromName} → {p.toName}
          </button>
        ))}
      </div>
    </section>
  );
  return (
    <div>
      <div className="pickers">
        <StationPicker label={en.from} value={from} onChange={setFrom} />
        <button className="btn btn-icon" aria-label={en.swap} onClick={() => { setFrom(to); setTo(from); }}>⇅</button>
        <StationPicker label={en.to} value={to} onChange={setTo} />
      </div>
      {!ready && <>{chips(en.saved, saved)}{chips(en.recent, recent)}</>}
      {ready && pair && (
        <section aria-label={en.nextTrains}>
          <div className="section-head">
            <h2>{en.nextTrains}</h2>
            <button className="btn" aria-pressed={isSaved(pair)}
              onClick={() => { toggleSaved(pair); addRecent(pair); }}>
              {isSaved(pair) ? "★ " + en.removeRoute : "☆ " + en.saveRoute}
            </button>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={showDeparted} onChange={(e) => setShowDeparted(e.target.checked)} />
            {en.showDeparted}
          </label>
          {q.isPending && <Loading />}
          {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
          {q.data && (
            <>
              <Freshness meta={q.data} />
              {q.data.journeys.length === 0
                ? <Empty>{en.noTrains}</Empty>
                : <ul className="list">{q.data.journeys.map((j) => <JourneyRow key={j.number + j.start_date} j={j} />)}</ul>}
            </>
          )}
        </section>
      )}
    </div>
  );
}
