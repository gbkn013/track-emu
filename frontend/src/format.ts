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
