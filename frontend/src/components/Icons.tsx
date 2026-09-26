import type { ReactNode } from "react";

// Small stroke icons (24×24 grid), inline so the app needs no icon dependency.
function Svg({ children, size = 20, fill = "none" }: { children: ReactNode; size?: number; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
  );
}
type P = { size?: number };
export const ChevronLeft = (p: P) => <Svg {...p}><path d="m15 18-6-6 6-6" /></Svg>;
export const ChevronRight = (p: P) => <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>;
export const Plus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const Check = (p: P) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>;
export const X = (p: P) => <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
export const Pencil = (p: P) => <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Svg>;
export const Trash = (p: P) => <Svg {...p}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></Svg>;
export const Gear = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></Svg>
);
export const Search = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></Svg>;
export const Board = (p: P) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M8 14h3M8 17h6" /></Svg>;
export const MapPin = (p: P) => <Svg {...p}><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></Svg>;
export const ArrowRight = (p: P) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const Swap = (p: P) => <Svg {...p}><path d="M7 4 3 8l4 4M3 8h18M17 20l4-4-4-4M21 16H3" /></Svg>;
export const SwapV = (p: P) => <Svg {...p}><path d="m8 3-4 4 4 4M4 7h12M16 21l4-4-4-4M20 17H8" transform="rotate(90 12 12)" /></Svg>;
export const Star = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Svg {...p} fill={filled ? "currentColor" : "none"}><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3-6.2 3.3L8 14.2 3 9.3l6.9-1Z" /></Svg>
);
export const Clock = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const Refresh = (p: P) => <Svg {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" /></Svg>;
export const History = (p: P) => <Svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" /></Svg>;
export const TrainFront = (p: P) => (
  <Svg {...p}><rect x="5" y="3" width="14" height="14" rx="3" /><path d="M5 11h14M9 21l2-4M15 21l-2-4" /><circle cx="9" cy="14" r=".6" /><circle cx="15" cy="14" r=".6" /></Svg>
);
