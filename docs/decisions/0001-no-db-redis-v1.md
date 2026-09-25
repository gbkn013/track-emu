# ADR 0001 — No Postgres/Redis/Alembic in the first working version

**Status:** accepted (2026-09-25) · **Deviates from:** AGENTS.md §5 default stack.

**Context.** The timetable is a 104 KiB committed JSON file; there is no user data (saved routes are client-side), and
live snapshots are short-lived. A database and Redis would add operational weight with no current benefit.

**Decision.** Load the catalogue into memory at start-up; use an in-process TTL cache with single-flight (allowed
by §5 "fall back to in-process cache") and a JSONL quota ledger on disk.

**Consequences.** One process, one container, zero external services. Cache and breaker state are per-process, so this
must run as a **single worker** (do not scale uvicorn workers without moving cache/ledger to Redis/DB).
`live_snapshots`/`run_exceptions` history (§6.2) is not persisted; revisit if we want delay analytics for tuning
`RECOVERY_MIN_PER_SEGMENT` or a worker/poller (Phase 5).
