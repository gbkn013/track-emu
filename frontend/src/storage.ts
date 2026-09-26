import { useCallback, useState } from "react";

export interface RoutePair { from: string; to: string; fromName: string; toName: string }
const KEY_SAVED = "tnrail.saved";
const KEY_RECENT = "tnrail.recent";

function read(key: string): RoutePair[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function write(key: string, v: RoutePair[]) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode / quota */ }
}
const same = (a: RoutePair, b: RoutePair) => a.from === b.from && a.to === b.to;

/** Saved + recent routes, client-side only (no accounts in v1, AGENTS.md §6.2). */
export function useRoutes() {
  const [saved, setSaved] = useState<RoutePair[]>(() => read(KEY_SAVED));
  const [recent, setRecent] = useState<RoutePair[]>(() => read(KEY_RECENT));
  const toggleSaved = useCallback((p: RoutePair) => {
    setSaved((cur) => {
      const next = cur.some((x) => same(x, p)) ? cur.filter((x) => !same(x, p)) : [p, ...cur];
      write(KEY_SAVED, next);
      return next;
    });
  }, []);
  const addRecent = useCallback((p: RoutePair) => {
    setRecent((cur) => {
      const next = [p, ...cur.filter((x) => !same(x, p))].slice(0, 20);
      write(KEY_RECENT, next);
      return next;
    });
  }, []);
  const removeSaved = useCallback((p: RoutePair) => {
    setSaved((cur) => { const next = cur.filter((x) => !same(x, p)); write(KEY_SAVED, next); return next; });
  }, []);
  const removeRecent = useCallback((p: RoutePair) => {
    setRecent((cur) => { const next = cur.filter((x) => !same(x, p)); write(KEY_RECENT, next); return next; });
  }, []);
  const clearSaved = useCallback(() => { write(KEY_SAVED, []); setSaved([]); }, []);
  const clearRecent = useCallback(() => { write(KEY_RECENT, []); setRecent([]); }, []);
  return {
    saved, recent, toggleSaved, addRecent, removeSaved, removeRecent, clearSaved, clearRecent,
    isSaved: (p: RoutePair) => saved.some((x) => same(x, p)),
  };
}
