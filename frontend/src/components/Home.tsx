import { useState } from "react";
import { useNow } from "../hooks";
import { en } from "../i18n/en";
import type { RoutePair, useRoutes } from "../storage";
import { HeaderButton, HeaderLink, ScreenHeader } from "./ScreenHeader";
import { ArrowRight, Board, Check, History, Pencil, Plus, Search, Gear, TrainFront, X } from "./Icons";
import { TripCard } from "./TripCard";

type Routes = ReturnType<typeof useRoutes>;

/** Home: saved trips, each with its next departures, then recent trips (TripView "Trips" screen). */
export function Home({ saved, recent, removeSaved, removeRecent }: Routes) {
  const [editing, setEditing] = useState(false);
  const now = useNow();
  const savedKeys = new Set(saved.map((t) => `${t.from}>${t.to}`));
  const recents: RoutePair[] = recent.filter((r) => !savedKeys.has(`${r.from}>${r.to}`)).slice(0, 8);
  const t = en.trips;
  return (
    <>
      <ScreenHeader
        title={t.title}
        actions={
          <>
            {saved.length > 0 && (
              <HeaderButton label={editing ? t.done : t.edit} onClick={() => setEditing((e) => !e)} pressed={editing}>
                {editing ? <Check size={20} /> : <Pencil size={20} />}
              </HeaderButton>
            )}
            <HeaderLink label={t.findTrain} href="#/trains"><Search size={20} /></HeaderLink>
            <HeaderLink label={t.stationBoard} href="#/board"><Board size={20} /></HeaderLink>
            <HeaderLink label={t.add} href="#/new"><Plus size={24} /></HeaderLink>
            <HeaderLink label={t.settings} href="#/settings"><Gear size={20} /></HeaderLink>
          </>
        }
      />
      <main className="main">
        {saved.length === 0 ? (
          <div className="empty-hero">
            <span className="brand-ic"><TrainFront size={56} /></span>
            <h2>{t.emptyTitle}</h2>
            <p>{t.emptyBody}</p>
            <a className="pill-btn" href="#/new">{t.emptyCta}</a>
          </div>
        ) : (
          <ul className="stack">
            {saved.map((s) => <TripCard key={s.from + s.to} trip={s} editing={editing} now={now} onRemove={() => removeSaved(s)} />)}
          </ul>
        )}
        {recents.length > 0 && (
          <section aria-labelledby="recent-h" className="recent">
            <h2 id="recent-h" className="eyebrow"><History size={16} /> {t.recent}</h2>
            <ul className="card list-card">
              {recents.map((r) => (
                <li key={r.from + r.to} className="recent-row">
                  <a href={`#/trip/${r.from}/${r.to}`}>
                    <span className="trunc">{r.fromName}</span>
                    <span className="brand-ic"><ArrowRight size={14} /></span>
                    <span className="trunc">{r.toName}</span>
                  </a>
                  <button type="button" aria-label={t.removeRecent(r.fromName, r.toName)} onClick={() => removeRecent(r)}><X size={16} /></button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
