.PHONY: setup dev dev-live test lint build e2e fixtures dataset run
PW_CHROMIUM ?=

setup:            ## install backend + frontend deps
	uv sync
	cd frontend && npm ci

dev:              ## backend (timetable only, no quota) on :8000 + vite on :5173
	@echo "API http://localhost:8000  |  UI http://localhost:5173"
	LIVE_SOURCE=none uv run uvicorn backend.app.api.main:create_app --factory --reload --port 8000 & \
	cd frontend && npm run dev

dev-live:         ## same, but RailRadar live overlay (needs RAILRADAR_API_KEY; SPENDS QUOTA)
	LIVE_SOURCE=railradar uv run uvicorn backend.app.api.main:create_app --factory --reload --port 8000 & \
	cd frontend && npm run dev

build:            ## production frontend bundle -> frontend/dist (served by the backend)
	cd frontend && npm run build

run: build        ## single-process production-style run on :8000
	uv run uvicorn backend.app.api.main:create_app --factory --host 0.0.0.0 --port 8000

test:             ## all offline unit tests (no network, no API key)
	uv run pytest -q
	cd frontend && npx vitest run

e2e: build        ## Playwright smoke tests (set PW_CHROMIUM=/path/to/chrome to reuse a browser)
	cd frontend && PW_CHROMIUM=$(PW_CHROMIUM) npx playwright test

lint:
	uv run ruff check backend scripts
	uv run ruff format --check backend scripts
	uv run mypy backend/app/eta backend/app/providers
	cd frontend && npx tsc --noEmit && npx eslint src

dataset:          ## rebuild the committed datameet extract (needs data/open/*.json, see docs)
	uv run python scripts/build_open_dataset.py

fixtures:         ## Phase 0 recording (MANUAL; spends quota, capped at 150 calls)
	uv run python scripts/phase0_probe.py status
	@echo "Run: uv run python scripts/phase0_probe.py catalogue|live <n...>|board <code...>"
