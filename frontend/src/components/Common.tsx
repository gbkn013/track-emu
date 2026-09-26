import type { ReactNode } from "react";
import { en } from "../i18n/en";
import type { EtaSource, Meta } from "../api";
import { badgeKind, delayText, delayTone } from "../format";

const ICON = { live: "●", estimated: "◐", scheduled: "○" } as const;

/** Source badge: icon + text (never colour alone), with a tooltip explaining it. */
export function SourceBadge({ source }: { source: EtaSource }) {
  const k = badgeKind(source);
  return (
    <span className={`badge badge-${k}`} title={en.sourceHelp[k]}>
      <span aria-hidden="true">{ICON[k]}</span> {en.source[k]}
    </span>
  );
}

/** No delay figure (null) renders nothing: never imply "on time" without live data. */
export function DelayChip({ delay }: { delay: number | null }) {
  if (delay === null) return null;
  const text = delayText(delay);
  return (
    <span className={`chip chip-${delayTone(delay)}`} aria-label={en.delayLabel(text)}>
      {text}
    </span>
  );
}

export function Freshness({ meta, now = Date.now(), compact }: { meta: Meta; now?: number; compact?: boolean }) {
  const stale = meta.stale_seconds ?? 0;
  const isStale = meta.data_mode !== "scheduled" && stale > 300;
  let text: string;
  let tone = "fresh-ok";
  if (meta.data_mode === "scheduled") {
    text = meta.live_configured ? en.fresh.scheduledOnly : `${en.fresh.scheduledOnly}. ${en.fresh.liveNotConfigured}`;
    tone = "fresh-sched";
  } else if (isStale) {
    text = `${en.fresh.stale} · ${en.fresh.updated(stale, meta.source)}`;
    tone = "fresh-stale";
  } else {
    text = en.fresh.updated(stale || Math.max(0, Math.round((now - new Date(meta.fetched_at).getTime()) / 1000)), meta.source);
  }
  return (
    <div className={`fresh ${tone}${compact ? " fresh-compact" : ""}`} role="status">
      <div>{text}</div>
      {meta.data_mode === "scheduled" && !compact && <div className="fresh-note">{meta.timetable_note}</div>}
    </div>
  );
}

export function Loading() {
  return (
    <div className="skeletons" aria-busy="true" aria-label={en.loading}>
      {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const msg = error instanceof Error ? error.message : en.error;
  return (
    <div className="errorbox" role="alert">
      <p>{en.error} <small>{msg}</small></p>
      <button className="btn" onClick={onRetry}>{en.retry}</button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Footer() {
  return (
    <footer className="footer">
      <p>{en.footer.unofficial}</p>
      <p>{en.footer.disclaimer}</p>
      <p>{en.footer.provider}</p>
    </footer>
  );
}
