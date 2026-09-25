# Single image: builds the PWA, then serves it + the API from one process.
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend ./backend
COPY --from=web /web/dist ./frontend/dist
ENV PATH="/app/.venv/bin:$PATH" LEDGER_PATH=/data/quota_ledger.jsonl
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/healthz')"
CMD ["uvicorn", "backend.app.api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
