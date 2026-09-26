import { defineConfig } from "@playwright/test";

// Smoke tests run against the static production build (`vite preview`) — no backend, no network.
// Build first: `npm run build`.
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
    command: "npx vite preview --host 127.0.0.1 --port 18766 --strictPort",
    url: "http://127.0.0.1:18766/",
    reuseExistingServer: false,
  },
});
