import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { en } from "../i18n/en";
import { hhmm } from "../format";
import { DelayChip, Empty, ErrorBox, Freshness, Loading, SourceBadge } from "./Common";
import { StationPicker } from "./StationPicker";

export function StationBoard({ code }: { code: string | null }) {
  const [hours, setHours] = useState(2);
  const [tab, setTab] = useState<"arr" | "dep">("arr");
  const q = useQuery({
    queryKey: ["board", code, hours], queryFn: () => api.board(code!, hours),
    enabled: !!code, refetchInterval: 60_000,
  });
  return (
    <div>
      <StationPicker label={en.board.title} value={q.data ? { code: q.data.code, name: q.data.name, lat: null, lng: null } : null}
        onChange={(s) => { if (s) location.hash = `#/station/${s.code}`; }} />
      {code && (
        <>
          <div className="tabs" role="tablist">
            {(["arr", "dep"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "tab tab-on" : "tab"} onClick={() => setTab(t)}>
                {t === "arr" ? en.board.arrivals : en.board.departures}
              </button>
            ))}
            <select aria-label="Window" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {[2, 4, 6, 8].map((h) => <option key={h} value={h}>{en.board.hours(h)}</option>)}
            </select>
            <button className="btn" onClick={() => q.refetch()}>{en.board.refresh}</button>
          </div>
          {q.isPending && <Loading />}
          {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
          {q.data && (
            <>
              <Freshness meta={q.data} />
              {/* Timetable data only carries one time per stop: departures hide trains that end here. */}
              {(() => {
                const rows = q.data.trains.filter((t) => tab === "arr" || !t.is_terminus);
                return rows.length === 0 ? <Empty>{en.noBoard}</Empty> : (
                  <ul className="list">
                    {rows.map((t) => (
                      <li key={t.number + t.scheduled} className="row">
                        <a className="row-link" href={`#/train/${t.number}`}>
                          <div className="row-main">
                            <span className="time-big">{hhmm(t.eta)}</span>
                            <DelayChip delay={t.eta_source === "scheduled" ? null : t.delay_min} />
                          </div>
                          <div className="row-sub">
                            <span>{t.number} · {t.name}</span>
                            <span>{t.is_terminus ? en.board.terminates : `→ ${t.to_name}`}{t.platform ? ` · ${en.platform(t.platform)}` : ""}</span>
                          </div>
                          <div className="row-badges"><SourceBadge source={t.eta_source} /></div>
                        </a>
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </>
          )}
        </>
      )}
    </div>
  );
}
