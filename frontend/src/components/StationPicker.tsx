import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { api, type Station } from "../api";
import { en } from "../i18n/en";
import { MapPin, X } from "./Icons";

interface Props {
  label: string;
  value: Station | null;
  onChange: (s: Station | null) => void;
  /** Station that cannot be chosen (the other end of the journey). */
  exclude?: string;
  autoFocus?: boolean;
}

/** Accessible station combobox: text field + listbox, arrow/enter/escape keys. */
export function StationPicker({ label, value, onChange, exclude, autoFocus }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { data, isFetching } = useQuery({ queryKey: ["stations", q], queryFn: () => api.stations(q), staleTime: 3_600_000 });
  const options = (data?.stations ?? []).filter((s) => s.code !== exclude);
  const isOpen = open && q.trim().length > 0;
  const display = open ? q : value ? `${value.name} (${value.code})` : q;

  const pick = (s: Station) => { onChange(s); setQ(""); setOpen(false); };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-box">
        <span className="field-icon"><MapPin size={16} /></span>
        <input
          id={id}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={isOpen && options[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          inputMode="search"
          value={display}
          placeholder={en.newTrip.placeholder}
          onFocus={(e) => { clearTimeout(blurTimer.current); setOpen(true); if (value) e.currentTarget.select(); }}
          onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
          onChange={(e) => { setOpen(true); setQ(e.target.value); setActive(0); if (value) onChange(null); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && isOpen && options[active]) { e.preventDefault(); pick(options[active]); }
            else if (e.key === "Escape") setOpen(false);
          }}
        />
        {(value || q) && (
          <button type="button" className="field-clear" aria-label={en.newTrip.clear(label)}
            onClick={() => { onChange(null); setQ(""); }}><X size={16} /></button>
        )}
      </div>
      {isOpen && (
        <ul id={`${id}-list`} role="listbox" aria-label={`${label} suggestions`} className="options">
          {options.map((s, i) => (
            <li key={s.code} id={`${id}-opt-${i}`} role="option" aria-selected={i === active}
              className={i === active ? "opt opt-on" : "opt"}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }} onMouseEnter={() => setActive(i)}>
              <span className="opt-name">{s.name}</span>{" "}
              <span className="opt-code">{s.code}</span>
            </li>
          ))}
          {options.length === 0 && (
            <li className="opt-empty" role="presentation">{isFetching ? en.newTrip.searching : en.newTrip.noStations}</li>
          )}
        </ul>
      )}
    </div>
  );
}
