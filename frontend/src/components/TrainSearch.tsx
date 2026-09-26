import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { KIND_COLOR } from "../format";
import { en } from "../i18n/en";
import { Empty, ErrorBox, Loading } from "./Common";
import { Search } from "./Icons";
import { ScreenHeader } from "./ScreenHeader";

export function TrainSearch() {
  const [q, setQ] = useState("");
  const r = useQuery({ queryKey: ["trains", q], queryFn: () => api.trains(q), staleTime: 3_600_000 });
  return (
    <>
      <ScreenHeader title={en.trips.findTrain} backHref="#/" />
      <main className="main">
        <div className="field">
          <label htmlFor="ts">{en.train.lookup}</label>
          <div className="field-box">
            <span className="field-icon"><Search size={16} /></span>
            <input id="ts" value={q} inputMode="search" onChange={(e) => setQ(e.target.value)} placeholder="e.g. 40015 or Tambaram" />
          </div>
        </div>
        {r.isPending && <Loading />}
        {r.isError && <ErrorBox error={r.error} onRetry={() => r.refetch()} />}
        {r.data && (r.data.trains.length === 0 ? <Empty>No matching trains.</Empty> : (
          <ul className="dep-list card">
            {r.data.trains.map((t) => (
              <li key={t.number} className="dep-item">
                <a className="dep" href={`#/train/${t.number}`}>
                  <div className="dep-mid">
                    <div className="dep-title">
                      <span className="dep-num" style={{ backgroundColor: KIND_COLOR[t.kind] ?? KIND_COLOR.OTHER }}>{t.number}</span>
                      <span className="dep-name">{t.name}</span>
                    </div>
                    <div className="dep-sub">{t.from_name} → {t.to_name}</div>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        ))}
      </main>
    </>
  );
}
