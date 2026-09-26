import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { en } from "../i18n/en";
import { loadLiveSettings, saveLiveSettings, effectiveLive } from "../local/settings";

/** Optional live data: the visitor's own RailRadar key, kept in this browser only. */
export function Settings() {
  const qc = useQueryClient();
  const [form, setForm] = useState(loadLiveSettings);
  const [msg, setMsg] = useState<string | null>(null);
  const status = useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 5_000 });
  const on = effectiveLive(loadLiveSettings()).enabled;

  const commit = (next: typeof form, message: string) => {
    saveLiveSettings(next);
    setForm(next);
    setMsg(message);
    void qc.invalidateQueries();
  };
  const st = status.data;
  return (
    <section>
      <h1>{en.settings.title}</h1>
      <p>{en.settings.intro}</p>
      <p role="status">{on ? en.settings.stateOn : en.settings.stateOff}</p>
      <form onSubmit={(e) => { e.preventDefault(); commit(form, en.settings.saved); }}>
        <div className="picker">
          <label htmlFor="rr-key">{en.settings.apiKey}</label>
          <input id="rr-key" type="password" autoComplete="off" spellCheck={false} value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        </div>
        <div className="picker">
          <label htmlFor="rr-base">{en.settings.baseUrl}</label>
          <input id="rr-base" inputMode="url" autoComplete="off" spellCheck={false} value={form.baseUrl}
            placeholder="https://api.railradar.in/v1" onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          <small>{en.settings.baseUrlHelp}</small>
        </div>
        <p>
          <button className="btn" type="submit">{en.settings.save}</button>{" "}
          <button className="btn" type="button" onClick={() => commit({ apiKey: "", baseUrl: "" }, en.settings.cleared)}>
            {en.settings.clear}
          </button>
        </p>
      </form>
      {msg && <p role="status">{msg}</p>}
      {st && (
        <ul>
          <li>{en.settings.quota(st.quota.used_this_month, st.quota.budget, st.quota.state)}</li>
          {st.cache.last_error && <li>{en.settings.lastError(st.cache.last_error)}</li>}
        </ul>
      )}
      <p><small>{en.settings.corsNote}</small></p>
    </section>
  );
}
