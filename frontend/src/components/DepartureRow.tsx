import type { Journey } from "../api";
import { en } from "../i18n/en";
import { delayText, formatAgo, formatCountdown, hhmm, istDay, KIND_COLOR, urgency } from "../format";
import { DelayChip, SourceBadge } from "./Common";

interface Props {
  j: Journey;
  now?: number;
  /** Compact variant used inside trip cards on the home screen. */
  compact?: boolean;
  /** Stations the user picked; the train page then highlights that segment. */
  trip?: { from: string; to: string };
  /** Hide the "due now / departed" state chips (a "leave at…" query is relative to another time). */
  hideState?: boolean;
}

/** One departure: time + countdown · train · arrival. Provenance (source badge) is always shown. */
export function DepartureRow({ j, now = Date.now(), compact, trip, hideState }: Props) {
  const dep = new Date(j.eta_at_a).getTime();
  const a = j.source_at_a === "scheduled" ? null : j.delay_at_a;
  const live = j.source_at_a === "actual" || j.source_at_a === "live_reported";
  const past = dep < now - 60_000;
  const u = urgency(dep, now);
  const dayShift = (Date.parse(istDay(j.eta_at_b)) - Date.parse(istDay(j.eta_at_a))) / 86_400_000;
  const href = `#/train/${j.number}${trip ? `/${trip.from}/${trip.to}` : ""}`;
  return (
    <li className="dep-item">
      <a className={`dep${compact ? " dep-compact" : ""}${past ? " dep-past" : ""}`} href={href}
        aria-label={`${j.name}, departs ${hhmm(j.eta_at_a)}${a === null ? "" : ", " + delayText(a)}`}>
        <div className="dep-when">
          <div className="dep-time">{hhmm(j.eta_at_a)}</div>
          <div className={`dep-count dep-${past ? "past" : u}`}>{past ? formatAgo(dep, now) : formatCountdown(dep, now)}</div>
        </div>
        <div className="dep-mid">
          <div className="dep-title">
            <span className="dep-num" style={{ backgroundColor: KIND_COLOR[j.kind] ?? KIND_COLOR.OTHER }}>{j.number}</span>
            <span className="dep-name">{j.name}</span>
          </div>
          <div className="dep-sub">{en.trip.towards(j.to_name)}{!compact && ` · ${en.ride(j.expected_ride_min)}${j.platform_at_a ? ` · ${en.platform(j.platform_at_a)}` : ""}`}</div>
          <div className="dep-chips">
            <SourceBadge source={j.source_at_a} />
            <DelayChip delay={a} />
            {!hideState && !past && (j.state_relative_to_a === "arriving" || j.state_relative_to_a === "at_station") && (
              <span className="chip chip-warn">{live ? en.state.arriving : en.state.dueNow}</span>
            )}
            {!hideState && j.state_relative_to_a === "departed" && (
              <span className="chip chip-none">{live ? en.state.departed : en.state.dueEarlier}</span>
            )}
          </div>
        </div>
        <div className="dep-arr">
          <div className="dep-arr-time">{hhmm(j.eta_at_b)}{dayShift > 0 && <sup>+{dayShift}</sup>}</div>
          <div className="dep-arr-l">{en.trip.arrive}</div>
        </div>
      </a>
    </li>
  );
}
