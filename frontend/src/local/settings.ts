// Visitor-supplied live-data settings, kept only in this browser's localStorage.
// The RailRadar key is never part of the build; without one the app is timetable-only.
import { config, OFFICIAL_BASE_URL } from "./config";

export interface LiveSettings { apiKey: string; baseUrl: string }

const KEY = "tnrail.live";
const listeners = new Set<() => void>();

export function loadLiveSettings(): LiveSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<LiveSettings>;
    return { apiKey: typeof v.apiKey === "string" ? v.apiKey : "", baseUrl: typeof v.baseUrl === "string" ? v.baseUrl : "" };
  } catch {
    return { apiKey: "", baseUrl: "" };
  }
}

export function saveLiveSettings(s: LiveSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify({ apiKey: s.apiKey.trim(), baseUrl: s.baseUrl.trim() })); } catch { /* blocked */ }
  listeners.forEach((f) => f());
}

export function onLiveSettingsChange(f: () => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** Live is on when the visitor gave a key, or a custom (proxy) base URL is set that holds the key itself. */
export function effectiveLive(s: LiveSettings): { enabled: boolean; baseUrl: string; apiKey: string } {
  const baseUrl = (s.baseUrl || config.railradarBaseUrl).replace(/\/+$/, "");
  return { enabled: s.apiKey.length > 0 || baseUrl !== OFFICIAL_BASE_URL, baseUrl, apiKey: s.apiKey };
}
