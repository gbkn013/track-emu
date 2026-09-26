/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Fully static build: relative asset URLs + hash routing, so it works from any path
// (GitHub Pages project sites, Cloudflare Pages, Netlify, S3, a plain file server).
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "TN Rail Tracker",
        short_name: "TN Rail",
        description: "Unofficial EMU/MEMU timetable and live tracker for Tamil Nadu",
        theme_color: "#f58220",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "./",
        scope: "./",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
    }),
  ],
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 1100 },
  test: { exclude: ["e2e/**", "node_modules/**"], environment: "jsdom", globals: true, setupFiles: ["./src/setupTests.ts"], css: false },
});
