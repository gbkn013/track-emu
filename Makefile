.PHONY: setup dev dev-live test lint build preview e2e fixtures dataset run
PW_CHROMIUM ?=

setup:            ## install backend + frontend deps
	uv sync
	cd frontend && npm ci

dev:              ## static app with hot reload on :5173 (no backend needed)
	cd frontend && npm run dev

dev-live:         ## same as dev; add your RailRadar key on the app's "Live data" tab (SPENDS QUOTA)
	cd frontend && npm run dev

build:            ## static site -> frontend/dist (deploy to any static host)
	cd frontend && npm run build

preview: build    ## serve the built static site on :4173
	cd frontend && npx vite preview --host 127.0.0.1 --port 4173

run: build        ## legacy: serve the build via the Python backend on :8000
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
