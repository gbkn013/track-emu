"""Quota ledger + budget guard (AGENTS.md §6.3.3). File-backed JSONL ledger."""

from __future__ import annotations

import json
from enum import StrEnum
from pathlib import Path

from ..core.timeutil import utcnow


class BudgetState(StrEnum):
    OK = "ok"
    STRETCH = "stretch"  # >80% used: callers should lengthen TTLs
    EXHAUSTED = "exhausted"  # degrade to schedule-only


class QuotaLedger:
    def __init__(self, path: Path, monthly_budget: int, provider: str = "railradar") -> None:
        self.path, self.monthly_budget, self.provider = path, monthly_budget, provider

    def record(self, endpoint: str, status: int, latency_ms: int, cost: int = 1) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        row = {
            "ts": utcnow().isoformat(),
            "provider": self.provider,
            "endpoint": endpoint,
            "status": status,
            "latency_ms": latency_ms,
            "cost": cost,
        }
        with self.path.open("a") as f:
            f.write(json.dumps(row) + "\n")

    def used_this_month(self) -> int:
        if not self.path.exists():
            return 0
        month = utcnow().strftime("%Y-%m")
        total = 0
        for line in self.path.read_text().splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if str(r.get("ts", "")).startswith(month):
                total += int(r.get("cost", 1))
        return total

    def state(self) -> BudgetState:
        used = self.used_this_month()
        if used >= self.monthly_budget:
            return BudgetState.EXHAUSTED
        return BudgetState.STRETCH if used > 0.8 * self.monthly_budget else BudgetState.OK
