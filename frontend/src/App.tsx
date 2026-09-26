import { useEffect, useState } from "react";
import { Footer } from "./components/Common";
import { Home } from "./components/Home";
import { NewTrip } from "./components/NewTrip";
import { Settings } from "./components/Settings";
import { StationBoard } from "./components/StationBoard";
import { TrainDetail } from "./components/TrainDetail";
import { TrainSearch } from "./components/TrainSearch";
import { TripPage } from "./components/TripPage";
import { en } from "./i18n/en";
import { useRoutes } from "./storage";

export type Route =
  | { page: "home" } | { page: "trains" } | { page: "board"; code: string | null } | { page: "new" }
  | { page: "trip"; from: string; to: string; at: string | null }
  | { page: "train"; number: string; from?: string; to?: string }
  | { page: "settings" };

const CODE = /^[A-Z0-9]{1,6}$/i;

/** Tiny hash router (no extra dependency): #/trip/FROM/TO?at=…, #/train/NUM[/FROM/TO], … */
export function parseHash(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const [, a, b, c, d] = path.split("/");
  if (a === "train" && /^\d{5}$/.test(b ?? "")) {
    return CODE.test(c ?? "") && CODE.test(d ?? "")
      ? { page: "train", number: b, from: c.toUpperCase(), to: d.toUpperCase() }
      : { page: "train", number: b };
  }
  if (a === "trip" && CODE.test(b ?? "") && CODE.test(c ?? "") && b.toUpperCase() !== c.toUpperCase()) {
    return { page: "trip", from: b.toUpperCase(), to: c.toUpperCase(), at: new URLSearchParams(query).get("at") };
  }
  if (a === "new") return { page: "new" };
  if (a === "trains") return { page: "trains" };
  if (a === "settings") return { page: "settings" };
  if (a === "station") return { page: "board", code: CODE.test(b ?? "") ? b.toUpperCase() : null };
  if (a === "board") return { page: "board", code: null };
  return { page: "home" };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [offline, setOffline] = useState(!navigator.onLine);
  const routes = useRoutes();
  useEffect(() => {
    const h = () => { setRoute(parseHash(location.hash)); scrollTo(0, 0); };
    const on = () => setOffline(false), off = () => setOffline(true);
    addEventListener("hashchange", h); addEventListener("online", on); addEventListener("offline", off);
    return () => { removeEventListener("hashchange", h); removeEventListener("online", on); removeEventListener("offline", off); };
  }, []);
  return (
    <div className="shell">
      {offline && <div className="fresh fresh-stale" role="status">{en.offline}</div>}
      <div key={JSON.stringify(route)} className="screen-enter">
        {route.page === "home" && <Home {...routes} />}
        {route.page === "new" && <NewTrip isSaved={routes.isSaved} toggleSaved={routes.toggleSaved} />}
        {route.page === "trip" && (
          <TripPage from={route.from} to={route.to} at={route.at} isSaved={routes.isSaved} toggleSaved={routes.toggleSaved} addRecent={routes.addRecent} />
        )}
        {route.page === "trains" && <TrainSearch />}
        {route.page === "board" && <StationBoard code={route.code} />}
        {route.page === "train" && <TrainDetail number={route.number} from={route.from} to={route.to} />}
        {route.page === "settings" && <Settings clearRecent={routes.clearRecent} clearSaved={routes.clearSaved} />}
        <Footer />
      </div>
    </div>
  );
}
