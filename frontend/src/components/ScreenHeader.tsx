import type { ReactNode } from "react";
import { ChevronLeft } from "./Icons";

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Shows a back button; falls back to this hash when there is no history (deep link). */
  backHref?: string;
  actions?: ReactNode;
}

/** The orange TripView-style top bar: back · title/subtitle · actions. */
export function ScreenHeader({ title, subtitle, backHref, actions }: Props) {
  const back = () => {
    if (history.length > 1) history.back();
    else location.hash = backHref ?? "#/";
  };
  return (
    <header className="hdr">
      <div className="hdr-row">
        {backHref !== undefined && (
          <button type="button" className="hbtn" aria-label="Back" onClick={back}><ChevronLeft size={24} /></button>
        )}
        <div className={backHref === undefined ? "hdr-title hdr-title-pad" : "hdr-title"}>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="hdr-actions">{actions}</div>
      </div>
    </header>
  );
}

export function HeaderButton({ label, onClick, children, pressed }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean }) {
  return (
    <button type="button" className="hbtn" aria-label={label} aria-pressed={pressed} onClick={onClick}>{children}</button>
  );
}

export function HeaderLink({ label, href, children }: { label: string; href: string; children: ReactNode }) {
  return <a className="hbtn" aria-label={label} href={href}>{children}</a>;
}
