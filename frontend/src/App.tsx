import { useEffect, useState } from "react";
import { Footer } from "./components/Common";
import { Home } from "./components/Home";
import { StationBoard } from "./components/StationBoard";
import { TrainDetail } from "./components/TrainDetail";
import { TrainSearch } from "./components/TrainSearch";
import { en } from "./i18n/en";
import { useRoutes } from "./storage";

export type Route =
  | { page: "home" } | { page: "trains" } | { page: "board"; code: string | null }
  | { page: "train"; number: string };

/** Tiny hash router (no extra dependency). */
export function parseHash(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, "").split("/");
  if (a === "train" && /^\d{5}$/.test(b ?? "")) return { page: "train", number: b };
  if (a === "trains") return { page: "trains" };
  if (a === "station") return { page: "board", code: /^[A-Z0-9]{1,6}$/i.test(b ?? "") ? b.toUpperCase() : null };
  if (a === "board") return { page: "board", code: null };
  return { page: "home" };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [offline, setOffline] = useState(!navigator.onLine);
  const routes = useRoutes();
  useEffect(() => {
    const h = () => setRoute(parseHash(location.hash));
    const on = () => setOffline(false), off = () => setOffline(true);
    addEventListener("hashchange", h); addEventListener("online", on); addEventListener("offline", off);
    return () => { removeEventListener("hashchange", h); removeEventListener("online", on); removeEventListener("offline", off); };
  }, []);
  const tab = route.page === "train" ? "home" : route.page;
  return (
    <div className="app">
      <header className="top"><a href="#/" className="brand">{en.appName}</a></header>
      {offline && <div className="fresh fresh-stale" role="status">{en.offline}</div>}
      <main>
        {route.page === "home" && <Home {...routes} />}
        {route.page === "trains" && <TrainSearch />}
        {route.page === "board" && <StationBoard code={route.code} />}
        {route.page === "train" && <TrainDetail number={route.number} />}
      </main>
      <Footer />
      <nav className="tabbar" aria-label="Main">
        <a href="#/" aria-current={tab === "home" ? "page" : undefined}>{en.nav.home}</a>
        <a href="#/trains" aria-current={tab === "trains" ? "page" : undefined}>{en.nav.trains}</a>
        <a href="#/board" aria-current={tab === "board" ? "page" : undefined}>{en.nav.board}</a>
      </nav>
    </div>
  );
}
