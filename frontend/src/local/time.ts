// Time helpers (AGENTS.md §2). Instants are epoch milliseconds; dates are "YYYY-MM-DD" journey
// dates in IST (UTC+05:30, no DST). Nothing here reads the device timezone.
export const MIN = 60_000;
export const IST_OFFSET_MS = 19_800_000;

export type DateStr = string;

export const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** The IST calendar date of an instant. */
export function istDate(ms: number): DateStr {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(d: DateStr, n: number): DateStr {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10);
}

/** Instant of `minutesOfDay` (0..1439) on IST date `d`. */
export function combineIst(d: DateStr, minutesOfDay: number): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day) + minutesOfDay * MIN - IST_OFFSET_MS;
}

/** ISO-8601 with an explicit +05:30 offset (AGENTS.md §6.5). */
export function isoIst(ms: number): string {
  return `${new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 19)}+05:30`;
}

/** Parse an ISO string with any offset (or Z). Naive strings are taken as IST. */
export function parseIso(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const t = Date.parse(hasZone ? s : `${s}+05:30`);
  return Number.isNaN(t) ? null : t;
}

/** Whole seconds between `ms` and `now` (0 if `ms` is in the future). */
export function ageSeconds(ms: number, now: number): number {
  return Math.max(0, Math.trunc((now - ms) / 1000));
}

/** Python-style round-half-to-even, so ported delay maths matches the reference engine. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
