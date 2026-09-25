/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "TN Rail Tracker",
        short_name: "TN Rail",
        description: "Unofficial EMU/MEMU timetable and live tracker for Tamil Nadu",
        theme_color: "#0b5cad",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        // Timetable-ish reads are served stale-while-revalidate so the app opens offline.
        runtimeCaching: [
          {
            urlPattern: /\/api\/v1\/(stations|trains)(\/\d{5})?(\?.*)?$/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "timetable" },
          },
          {
            urlPattern: /\/api\/v1\/(journeys|stations\/.+\/board|trains\/\d{5}\/live)/,
            handler: "NetworkFirst",
            options: { cacheName: "live", networkTimeoutSeconds: 6 },
          },
        ],
      },
    }),
  ],
  server: { proxy: { "/api": "http://localhost:8000", "/healthz": "http://localhost:8000" } },
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 1100 },
  test: { exclude: ["e2e/**", "node_modules/**"], environment: "jsdom", globals: true, setupFiles: ["./src/setupTests.ts"], css: false },
});
