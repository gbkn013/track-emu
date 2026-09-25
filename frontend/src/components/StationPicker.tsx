import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api, type Station } from "../api";

interface Props { label: string; value: Station | null; onChange: (s: Station | null) => void }

/** Accessible combobox-lite: text input + datalist-style listbox of matches. */
export function StationPicker({ label, value, onChange }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const id = useId();
  const { data } = useQuery({ queryKey: ["stations", q], queryFn: () => api.stations(q), staleTime: 3_600_000 });
  const shown = open ? (data?.stations ?? []) : [];
  return (
    <div className="picker">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        autoComplete="off"
        inputMode="search"
        value={open ? q : (value?.name ?? q)}
        placeholder="Station name or code"
        onFocus={() => { setQ(""); setOpen(true); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); if (value) onChange(null); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {shown.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="options">
          {shown.map((s) => (
            <li key={s.code} role="option" aria-selected={value?.code === s.code}>
              <button type="button" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(s); setQ(""); setOpen(false); }}>
                <strong>{s.name}</strong> <span className="code">{s.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
