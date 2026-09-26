import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { dayHeading } from "../format";
import { useNow } from "../hooks";
import { en } from "../i18n/en";
import type { RoutePair } from "../storage";
import { combineIst, istDate } from "../local/time";
import { DepartureRow } from "./DepartureRow";
import { Empty, ErrorBox, Freshness } from "./Common";
import { Clock, Star, Swap } from "./Icons";
import { HeaderButton, ScreenHeader } from "./ScreenHeader";

interface Props {
  from: string; to: string; at: string | null;
  isSaved: (p: RoutePair) => boolean;
  toggleSaved: (p: RoutePair) => void;
  addRecent: (p: RoutePair) => void;
}

const MAX_EARLIER_H = 6;
const MAX_HORIZON_H = 24;

function useStationName(code: string) {
  const q = useQuery({
    queryKey: ["station-name", code],
    queryFn: async () => (await api.stations(code)).stations.find((s) => s.code === code)?.name ?? code,
    staleTime: Infinity,
  });
  return q.data ?? code;
}

/** All direct trains between two stations, live-adjusted where possible (TripView "trip" screen). */
export function TripPage({ from, to, at, isSaved, toggleSaved, addRecent }: Props) {
  const now = useNow();
  const [earlierH, setEarlierH] = useState(0);
  const [horizonH, setHorizonH] = useState(6);
  const [picking, setPicking] = useState(false);
  const fromName = useStationName(from);
  const toName = useStationName(to);
  const pair: RoutePair = { from, to, fromName, toName };
  const validAt = at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? at : null;

  const q = useQuery({
    queryKey: ["journeys", from, to, validAt, earlierH, horizonH],
    queryFn: () => api.journeys(from, to, false, {
      at: validAt ?? undefined, horizonH, limit: 60, earlierMin: earlierH > 0 ? earlierH * 60 : undefined,
    }),
    refetchInterval: 60_000,
  });

  // Remember every viewed trip so it shows up under "Recent" on the home screen.
  const ready = q.isSuccess;
  useEffect(() => { if (ready) addRecent({ from, to, fromName, toName }); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, from, to, fromName, toName]);

  const setAt = (v: string | null) => { location.hash = `#/trip/${from}/${to}${v ? `?at=${v}` : ""}`; };
  const saved = isSaved(pair);
  const today = istDate(now);
  const reference = validAt ? combineIst(validAt.slice(0, 10), Number(validAt.slice(11, 13)) * 60 + Number(validAt.slice(14, 16))) : now;
  const t = en.trip;
  const rows = q.data?.journeys ?? [];

  return (
    <>
      <ScreenHeader
        backHref="#/"
        title={`${fromName} → ${toName}`}
        subtitle={validAt ? t.leaving(`${validAt.slice(0, 10)} ${validAt.slice(11)}`) : t.leavingNow}
        actions={
          <>
            <HeaderButton label={t.swapDir} onClick={() => { location.hash = `#/trip/${to}/${from}`; }}><Swap size={20} /></HeaderButton>
            <HeaderButton label={saved ? t.unsaveTrip : t.saveTrip} pressed={saved} onClick={() => toggleSaved(pair)}>
              <Star size={20} filled={saved} />
            </HeaderButton>
          </>
        }
      />

      <div className="timebar">
        <button type="button" className="chip-btn" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
          <span className="brand-ic"><Clock size={16} /></span> {validAt ? t.changeTime : t.leaveAt}
        </button>
        {validAt && <button type="button" className="link-btn" onClick={() => setAt(null)}>{t.leaveNow}</button>}
        {picking && (
          <form className="timeform" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const d = String(f.get("d")), tm = String(f.get("t"));
            if (d && tm) setAt(`${d}T${tm}`);
            setPicking(false);
          }}>
            <label className="sr-only" htmlFor="at-date">{t.date}</label>
            <input id="at-date" name="d" type="date" required min={today} defaultValue={validAt?.slice(0, 10) ?? today} />
            <label className="sr-only" htmlFor="at-time">{t.time}</label>
            <input id="at-time" name="t" type="time" required defaultValue={validAt?.slice(11) ?? "08:00"} />
            <button type="submit" className="pill-btn pill-sm">{t.go}</button>
          </form>
        )}
      </div>

      <main>
        {q.data && <div className="pad-x"><Freshness meta={q.data} /></div>}

        {q.isSuccess && (
          <div className="more-row">
            {earlierH < MAX_EARLIER_H && (
              <button type="button" className="pill-out" onClick={() => setEarlierH((h) => h + 1)}>{t.earlier}</button>
            )}
            {earlierH > 0 && <button type="button" className="link-btn muted-btn" onClick={() => setEarlierH(0)}>{t.hide}</button>}
          </div>
        )}

        {q.isPending && (
          <div role="status" aria-label={en.loading}>{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton sk-row" />)}</div>
        )}
        {q.isError && (
          <div className="card empty-card">
            <p className="strong">{t.loadFail}</p>
            <ErrorBox error={q.error} onRetry={() => q.refetch()} />
          </div>
        )}
        {q.isSuccess && rows.length === 0 && (
          <div className="card empty-card">
            <Empty>{en.noTrains}</Empty>
            <p className="muted">{t.emptyHint}</p>
            <a className="pill-btn" href="#/new">{t.otherStations}</a>
          </div>
        )}

        <ul className="dep-list dep-page">
          {rows.map((j, i) => {
            const prev = rows[i - 1];
            const sep = prev && new Date(prev.eta_at_a).getTime() < reference && new Date(j.eta_at_a).getTime() >= reference;
            const newDay = i === 0 || dayHeading(prev.eta_at_a, now) !== dayHeading(j.eta_at_a, now);
            return (
              <Fragment key={j.number + j.start_date}>
                {sep && <li role="separator" className="upcoming"><span />{t.upcoming}<span /></li>}
                {newDay && <li className="day-head" aria-label={dayHeading(j.eta_at_a, now)}>{dayHeading(j.eta_at_a, now)}</li>}
                <DepartureRow j={j} now={now} trip={{ from, to }} hideState={!!validAt} />
              </Fragment>
            );
          })}
        </ul>

        {q.isSuccess && horizonH < MAX_HORIZON_H && (
          <div className="more-row">
            <button type="button" className="pill-out" onClick={() => setHorizonH((h) => Math.min(MAX_HORIZON_H, h + 6))}>{t.later}</button>
          </div>
        )}
      </main>
    </>
  );
}
