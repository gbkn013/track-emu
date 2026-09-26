import { en } from "./i18n/en";
import type { EtaSource } from "./api";

const TZ = "Asia/Kolkata";
const fmt = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });

/** HH:MM in IST regardless of the viewer's device timezone. */
export function hhmm(iso: string | null | undefined): string {
  return iso ? fmt.format(new Date(iso)) : "—";
}

export function delayText(d: number | null): string {
  if (d === null) return en.delayUnknown;
  if (d === 0) return en.onTime;
  return d < 0 ? en.minEarly(-d) : en.minLate(d);
}

export type BadgeKind = "live" | "estimated" | "scheduled";
/** actual/live_reported -> live; propagated -> estimated; scheduled -> scheduled. */
export function badgeKind(s: EtaSource): BadgeKind {
  return s === "actual" || s === "live_reported" ? "live" : s === "propagated" ? "estimated" : "scheduled";
}

/** Only shows a delay tone when we actually have a delay figure. */
export function delayTone(d: number | null): "none" | "ok" | "warn" | "bad" {
  if (d === null) return "none";
  return d <= 2 ? "ok" : d <= 10 ? "warn" : "bad";
}

const dayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });
const ymd = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ });

/** IST calendar date (YYYY-MM-DD) of an ISO instant or epoch ms. */
export function istDay(v: string | number): string {
  return ymd.format(new Date(v));
}

/** "Today" / "Tomorrow" / weekday, plus "Mon, 21 Sep" — for the day headings in a departure list. */
export function dayHeading(iso: string, now: number): string {
  const d = istDay(iso);
  const today = istDay(now);
  const tomorrow = istDay(now + 86_400_000);
  const label = d === today ? "Today" : d === tomorrow ? "Tomorrow" : dayFmt.format(new Date(iso)).split(",")[0];
  return `${label} · ${dayFmt.format(new Date(iso)).replace(/^\w+,? /, "")}`;
}

/** "Now", "12 min", "2h 05m". Rounds down so it never overstates how long you have. */
export function formatCountdown(etaMs: number, now: number): string {
  const ms = etaMs - now;
  if (ms < 60_000) return "Now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  if (mins >= 24 * 60) return `in ${Math.floor(mins / (24 * 60))} d`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** "12 min ago", "2h 05m ago" for a train that has already left. */
export function formatAgo(etaMs: number, now: number): string {
  const mins = Math.max(1, Math.floor((now - etaMs) / 60_000));
  return mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m ago`;
}

export type Urgency = "now" | "soon" | "later";
export function urgency(etaMs: number, now: number): Urgency {
  const mins = (etaMs - now) / 60_000;
  return mins < 1 ? "now" : mins <= 15 ? "soon" : "later";
}

/** Line colour per service kind (TripView colours by line; here by EMU / MEMU / MRTS). */
export const KIND_COLOR: Record<string, string> = { EMU: "#1976d2", MEMU: "#7b3fb3", MRTS: "#00838f", OTHER: "#616161" };
