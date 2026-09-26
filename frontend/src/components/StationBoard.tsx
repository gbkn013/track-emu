import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type BoardRow } from "../api";
import { en } from "../i18n/en";
import { formatAgo, formatCountdown, hhmm, KIND_COLOR, urgency } from "../format";
import { useNow } from "../hooks";
import { DelayChip, Empty, ErrorBox, Freshness, Loading, SourceBadge } from "./Common";
import { Refresh } from "./Icons";
import { HeaderButton, ScreenHeader } from "./ScreenHeader";
import { StationPicker } from "./StationPicker";

function Row({ t, now }: { t: BoardRow; now: number }) {
  const at = new Date(t.eta).getTime();
  const past = at < now - 60_000;
  const u = urgency(at, now);
  return (
    <li className="dep-item">
      <a className={`dep${past ? " dep-past" : ""}`} href={`#/train/${t.number}`}>
        <div className="dep-when">
          <div className="dep-time">{hhmm(t.eta)}</div>
          <div className={`dep-count dep-${past ? "past" : u}`}>{past ? formatAgo(at, now) : formatCountdown(at, now)}</div>
        </div>
        <div className="dep-mid">
          <div className="dep-title">
            <span className="dep-num" style={{ backgroundColor: KIND_COLOR.EMU }}>{t.number}</span>
            <span className="dep-name">{t.name}</span>
          </div>
          <div className="dep-sub">{t.is_terminus ? en.board.terminates : en.trip.towards(t.to_name)}{t.platform ? ` · ${en.platform(t.platform)}` : ""}</div>
          <div className="dep-chips"><SourceBadge source={t.eta_source} /><DelayChip delay={t.eta_source === "scheduled" ? null : t.delay_min} /></div>
        </div>
      </a>
    </li>
  );
}

export function StationBoard({ code }: { code: string | null }) {
  const [hours, setHours] = useState(2);
  const [tab, setTab] = useState<"arr" | "dep">("arr");
  const now = useNow();
  const q = useQuery({
    queryKey: ["board", code, hours], queryFn: () => api.board(code!, hours),
    enabled: !!code, refetchInterval: 60_000,
  });
  const rows = q.data?.trains.filter((t) => tab === "arr" || !t.is_terminus) ?? [];
  return (
    <>
      <ScreenHeader
        backHref="#/"
        title={q.data ? q.data.name : en.board.title}
        subtitle={q.data ? en.board.title : undefined}
        actions={code ? <HeaderButton label={en.board.refresh} onClick={() => void q.refetch()}><Refresh size={20} /></HeaderButton> : undefined}
      />
      <main className="main">
        <div className="card pad-lg">
          <StationPicker label={en.board.title} value={q.data ? { code: q.data.code, name: q.data.name, lat: null, lng: null } : null}
            onChange={(s) => { if (s) location.hash = `#/station/${s.code}`; }} />
        </div>
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
            </div>
            {q.isPending && <Loading />}
            {q.isError && <ErrorBox error={q.error} onRetry={() => q.refetch()} />}
            {q.data && (
              <>
                <Freshness meta={q.data} />
                {/* Timetable data only carries one time per stop: departures hide trains that end here. */}
                {rows.length === 0 ? <Empty>{en.noBoard}</Empty> : (
                  <ul className="dep-list card">{rows.map((t) => <Row key={t.number + t.scheduled} t={t} now={now} />)}</ul>
                )}
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
