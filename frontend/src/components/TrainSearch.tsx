import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { en } from "../i18n/en";
import { Empty, ErrorBox, Loading } from "./Common";

export function TrainSearch() {
  const [q, setQ] = useState("");
  const r = useQuery({ queryKey: ["trains", q], queryFn: () => api.trains(q), staleTime: 3_600_000 });
  return (
    <div>
      <div className="picker">
        <label htmlFor="ts">{en.train.lookup}</label>
        <input id="ts" value={q} inputMode="search" onChange={(e) => setQ(e.target.value)} placeholder="e.g. 40015 or Tambaram" />
      </div>
      {r.isPending && <Loading />}
      {r.isError && <ErrorBox error={r.error} onRetry={() => r.refetch()} />}
      {r.data && (r.data.trains.length === 0 ? <Empty>No matching trains.</Empty> : (
        <ul className="list">
          {r.data.trains.map((t) => (
            <li key={t.number} className="row">
              <a className="row-link" href={`#/train/${t.number}`}>
                <div className="row-main"><span className="time-mid">{t.number}</span></div>
                <div className="row-sub"><span>{t.name}</span><span>{t.from_name} → {t.to_name}</span></div>
              </a>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
