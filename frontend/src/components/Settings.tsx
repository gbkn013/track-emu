import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { en } from "../i18n/en";
import { effectiveLive, loadLiveSettings, saveLiveSettings } from "../local/settings";
import type { useRoutes } from "../storage";
import { useTheme, type Theme } from "../theme";
import { ScreenHeader } from "./ScreenHeader";

type Routes = ReturnType<typeof useRoutes>;

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: en.appearance.light },
  { value: "dark", label: en.appearance.dark },
  { value: "system", label: en.appearance.system },
];

export function Settings({ clearRecent, clearSaved }: Pick<Routes, "clearRecent" | "clearSaved">) {
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [form, setForm] = useState(loadLiveSettings);
  const [msg, setMsg] = useState("");
  const [notice, setNotice] = useState("");
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 5_000 });
  const on = effectiveLive(loadLiveSettings()).enabled;
  const st = status.data;

  const commit = (next: typeof form, message: string) => {
    saveLiveSettings(next);
    setForm(next);
    setMsg(message);
    void qc.invalidateQueries();
  };

  return (
    <>
      <ScreenHeader title={en.trips.settings} backHref="#/" />
      <main className="main settings">
        <section className="card pad-lg">
          <h2 className="card-title">{en.appearance.title}</h2>
          <p className="muted small">{en.appearance.body}</p>
          <div role="radiogroup" aria-label={en.appearance.title}>
            {THEMES.map((t) => (
              <label key={t.value} className="radio">
                <input type="radio" name="theme" value={t.value} checked={theme === t.value}
                  onChange={() => setTheme(t.value)} />
                {t.label}
              </label>
            ))}
          </div>
        </section>

        <section className="card pad-lg">
          <h2 className="card-title">{en.settings.title}</h2>
          <p className="muted small">{en.settings.intro}</p>
          <p role="status" className="strong">{on ? en.settings.stateOn : en.settings.stateOff}</p>
          <form onSubmit={(e) => { e.preventDefault(); commit(form, en.settings.saved); }}>
            <div className="field">
              <label htmlFor="rr-key">{en.settings.apiKey}</label>
              <div className="field-box"><input id="rr-key" className="plain" type="password" autoComplete="off" spellCheck={false}
                value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></div>
            </div>
            <div className="field">
              <label htmlFor="rr-base">{en.settings.baseUrl}</label>
              <div className="field-box"><input id="rr-base" className="plain" inputMode="url" autoComplete="off" spellCheck={false}
                value={form.baseUrl} placeholder="https://api.railradar.in/v1"
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></div>
              <p className="muted small">{en.settings.baseUrlHelp}</p>
            </div>
            <div className="btn-row">
              <button className="pill-btn pill-sm" type="submit">{en.settings.save}</button>
              <button className="pill-out" type="button" onClick={() => commit({ apiKey: "", baseUrl: "" }, en.settings.cleared)}>
                {en.settings.clear}
              </button>
            </div>
          </form>
          {msg && <p role="status" className="ok-text">{msg}</p>}
          {st && (
            <ul className="plain-list small muted">
              <li>{en.settings.quota(st.quota.used_this_month, st.quota.budget, st.quota.state)}</li>
              {st.cache.last_error && <li>{en.settings.lastError(st.cache.last_error)}</li>}
            </ul>
          )}
          <p className="muted small">{en.settings.corsNote}</p>
        </section>

        <section className="card pad-lg">
          <h2 className="card-title">{en.data.title}</h2>
          <p role="status" className="ok-text minh">{notice}</p>
          <div className="setting-row">
            <div><h3>{en.data.clearRecent}</h3><p className="muted small">{en.data.clearRecentBody}</p></div>
            <button className="pill-out" onClick={() => { clearRecent(); setNotice(en.data.recentCleared); }}>{en.data.clear}</button>
          </div>
          <div className="setting-row">
            <div><h3>{en.data.clearTrips}</h3><p className="muted small">{en.data.clearTripsBody}</p></div>
            <button className="pill-out" onClick={() => { clearSaved(); setNotice(en.data.tripsCleared); }}>{en.data.clear}</button>
          </div>
          <div className="setting-row">
            <div><h3>{en.data.source}</h3><p className="muted small">{en.data.sourceBody}</p></div>
          </div>
        </section>

        <section className="card pad-lg">
          <h2 className="card-title">{en.about.title}</h2>
          <p className="muted small">{en.about.body}</p>
          <ul className="bullets small muted">{en.about.features.map((f) => <li key={f}>{f}</li>)}</ul>
        </section>
      </main>
    </>
  );
}
