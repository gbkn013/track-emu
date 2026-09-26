// Light / Dark / System theme (TripView-style). A forced choice is a class on <html>; "system"
// leaves it to prefers-color-scheme (see styles.css). index.html applies it before first paint.
import { useCallback, useState } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "theme";

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch { return "system"; }
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (t !== "system") root.classList.add(t);
  try { if (t === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* blocked */ }
}

export function useTheme() {
  const [theme, set] = useState<Theme>(readTheme);
  const setTheme = useCallback((t: Theme) => { applyTheme(t); set(t); }, []);
  return { theme, setTheme };
}
