// TTL cache with single-flight, circuit breaker and stale-serving (AGENTS.md §6.3.2, §6.3.6).
// One upstream call per key per TTL; concurrent callers share the flight. On failure the breaker
// opens (honouring Retry-After) and stale values are served for up to maxStaleS, else null —
// callers then degrade to schedule-only.
import { ProviderError } from "./errors";

export interface Cached<T> { value: T; fetchedAt: number }

export class LiveCache {
  private data = new Map<string, Cached<unknown>>();
  private flights = new Map<string, Promise<Cached<unknown> | null>>();
  private openUntil = 0;
  private failStreak = 0;
  hits = 0;
  misses = 0;
  lastError: string | null = null;

  constructor(private maxStaleS = 1800, private clock: () => number = Date.now, private jitter: () => number = Math.random) {}

  get breakerOpen(): boolean { return this.clock() < this.openUntil; }
  ageS(c: Cached<unknown>): number { return (this.clock() - c.fetchedAt) / 1000; }
  clear(): void { this.data.clear(); this.openUntil = 0; this.failStreak = 0; this.lastError = null; }
  /** Test hook: pretend an entry was fetched `ms` earlier. */
  backdate(key: string, ms: number): void { const c = this.data.get(key); if (c) c.fetchedAt -= ms; }

  async get<T>(key: string, ttlS: number, fetch: () => Promise<T>): Promise<Cached<T> | null> {
    const c = this.data.get(key) as Cached<T> | undefined;
    if (c && this.ageS(c) < ttlS) { this.hits++; return c; }
    if (this.breakerOpen) return this.stale<T>(key);
    const inflight = this.flights.get(key);
    if (inflight) return (await inflight) as Cached<T> | null;

    this.misses++;
    const p = (async (): Promise<Cached<unknown> | null> => {
      try {
        const value = await fetch();
        this.failStreak = 0;
        const fresh: Cached<T> = { value, fetchedAt: this.clock() };
        this.data.set(key, fresh);
        return fresh;
      } catch (e) {
        this.trip(e);
        return this.stale<T>(key);
      } finally {
        this.flights.delete(key);
      }
    })();
    this.flights.set(key, p);
    return (await p) as Cached<T> | null;
  }

  private trip(e: unknown): void {
    this.failStreak++;
    const pe = e instanceof ProviderError ? e : null;
    this.lastError = pe?.code ?? "provider_error";
    const delayS = pe?.retryAfterS ? pe.retryAfterS : Math.min(300, 5 * 2 ** Math.min(this.failStreak, 6));
    this.openUntil = this.clock() + delayS * 1000 * (0.8 + 0.4 * this.jitter());
  }

  private stale<T>(key: string): Cached<T> | null {
    const c = this.data.get(key) as Cached<T> | undefined;
    return c && this.ageS(c) <= this.maxStaleS ? c : null;
  }
}
