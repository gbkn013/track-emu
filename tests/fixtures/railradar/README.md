# Recorded RailRadar fixtures

**Currently empty — Phase 0 has not been run** (no API key yet). An earlier
version of this file claimed a 2026-09-21 recording; nothing was found on disk,
so that claim was removed.

Fixtures are written by `scripts/phase0_probe.py` (manual; spends quota, capped
at 150 calls via `data/quota_ledger.jsonl`). Each file is
`{_recorded_at, _status, _headers, body}` where `body` is the raw provider
envelope and `_headers` holds only rate-limit/request-id headers — the
Authorization header and API key are never stored.

Naming: `{step}_{method}_{ident}.json`, e.g. `01_get_chennai-local-trains.json`.
