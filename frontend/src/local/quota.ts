// Quota ledger + budget guard (AGENTS.md §6.3.3). Client-side: a per-month counter in
// localStorage (this browser's own key/quota — there is no shared server to count for it).
import { config } from "./config";

export type BudgetState = "ok" | "stretch" | "exhausted";

const keyFor = (ms: number) => `tnrail.quota.${new Date(ms).toISOString().slice(0, 7)}`;

export class QuotaLedger {
  private mem = new Map<string, number>();
  constructor(private budget: () => number = () => config.monthlyRequestBudget, private clock: () => number = Date.now) {}

  private read(k: string): number {
    try {
      const v = Number(localStorage.getItem(k));
      if (Number.isFinite(v) && v > 0) return v;
    } catch { /* storage blocked */ }
    return this.mem.get(k) ?? 0;
  }

  /** Every upstream call is logged (cost 1 unless the provider says otherwise). */
  record(_endpoint: string, _status: number, _latencyMs: number, cost = 1): void {
    const k = keyFor(this.clock());
    const n = this.read(k) + cost;
    this.mem.set(k, n);
    try { localStorage.setItem(k, String(n)); } catch { /* storage blocked */ }
  }

  usedThisMonth(): number { return this.read(keyFor(this.clock())); }

  state(): BudgetState {
    const used = this.usedThisMonth();
    const b = this.budget();
    if (used >= b) return "exhausted";
    return used > 0.8 * b ? "stretch" : "ok";
  }
}
