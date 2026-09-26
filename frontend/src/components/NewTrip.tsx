import { useState } from "react";
import type { Station } from "../api";
import { en } from "../i18n/en";
import type { RoutePair } from "../storage";
import { StationPicker } from "./StationPicker";
import { ScreenHeader } from "./ScreenHeader";
import { SwapV } from "./Icons";

interface Props { isSaved: (p: RoutePair) => boolean; toggleSaved: (p: RoutePair) => void }

export function NewTrip({ isSaved, toggleSaved }: Props) {
  const [from, setFrom] = useState<Station | null>(null);
  const [to, setTo] = useState<Station | null>(null);
  const [save, setSave] = useState(true);
  const same = !!from && !!to && from.code === to.code;
  const ready = !!from && !!to && !same;
  const t = en.newTrip;

  const go = (e: React.FormEvent) => {
    e.preventDefault();
    if (!from || !to || same) return;
    const pair = { from: from.code, to: to.code, fromName: from.name, toName: to.name };
    if (save && !isSaved(pair)) toggleSaved(pair);
    location.hash = `#/trip/${from.code}/${to.code}`;
  };

  return (
    <>
      <ScreenHeader title={t.title} backHref="#/" />
      <form onSubmit={go} className="form">
        <div className="card pad-lg">
          <StationPicker label={en.from} value={from} onChange={setFrom} exclude={to?.code} />
          <div className="swap-row">
            <button type="button" className="round-btn" aria-label={t.swap} disabled={!from && !to}
              onClick={() => { setFrom(to); setTo(from); }}><SwapV size={20} /></button>
          </div>
          <StationPicker label={en.to} value={to} onChange={setTo} exclude={from?.code} />
          {same && <p role="alert" className="err-text">{t.same}</p>}
        </div>
        <label className="check">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          {t.save}
        </label>
        <button type="submit" className="pill-btn pill-block" disabled={!ready}>{t.submit}</button>
      </form>
    </>
  );
}
