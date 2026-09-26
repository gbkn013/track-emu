import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { en } from "../i18n/en";
import type { RoutePair } from "../storage";
import { Freshness } from "./Common";
import { DepartureRow } from "./DepartureRow";
import { ArrowRight, Trash } from "./Icons";

const NEXT_COUNT = 3;

/** A saved trip on the home screen: route title + the next few departures. */
export function TripCard({ trip, editing, onRemove, now }: { trip: RoutePair; editing: boolean; onRemove: () => void; now: number }) {
  const q = useQuery({
    queryKey: ["journeys", trip.from, trip.to, false],
    queryFn: () => api.journeys(trip.from, trip.to, false),
    refetchInterval: 60_000,
  });
  const next = q.data?.journeys.slice(0, NEXT_COUNT) ?? [];
  return (
    <li className="card trip-card">
      <div className="trip-head">
        <a className="trip-title" href={`#/trip/${trip.from}/${trip.to}`}>
          <span className="trunc">{trip.fromName}</span>
          <span className="brand-ic"><ArrowRight size={16} /></span>
          <span className="trunc">{trip.toName}</span>
        </a>
        {editing && (
          <button type="button" className="trash" aria-label={en.trips.removeTrip(trip.fromName, trip.toName)} onClick={onRemove}>
            <Trash size={20} />
          </button>
        )}
      </div>
      {q.isPending && (
        <div className="pad" role="status" aria-label={en.loading}>
          {[0, 1, 2].map((i) => <div key={i} className="skeleton sk-line" />)}
        </div>
      )}
      {q.isError && (
        <div className="pad muted-row">
          {en.trips.loadFail} <button type="button" className="link-btn" onClick={() => q.refetch()}>{en.retry}</button>
        </div>
      )}
      {q.data && next.length === 0 && <p className="pad muted">{en.trips.none}</p>}
      {next.length > 0 && <ul className="dep-list">{next.map((j) => <DepartureRow key={j.number + j.start_date} j={j} now={now} compact trip={trip} />)}</ul>}
      {q.data && <Freshness meta={q.data} compact />}
    </li>
  );
}
