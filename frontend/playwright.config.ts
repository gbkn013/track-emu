import { defineConfig } from "@playwright/test";

// Smoke tests run the real backend (static datameet timetable, no live source, no network)
// serving the built frontend. Build first: `npm run build`.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:18766",
    serviceWorkers: "block",
    // Optional: reuse an already-installed Chromium (e.g. PW_CHROMIUM=~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome)
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: "uv run uvicorn backend.app.api.main:create_app --factory --port 18766",
    cwd: "..",
    url: "http://127.0.0.1:18766/healthz",
    env: { LIVE_SOURCE: "none", RAILRADAR_API_KEY: "" },
    reuseExistingServer: false,
  },
});
