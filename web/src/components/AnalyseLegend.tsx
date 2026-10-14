import type { ReactNode } from "react";

import { AMARKS } from "@/lib/analyse-marks";

/**
 * Analyse's legend row (reset-analyse-cykel.md §4, Main's legend row): at the bottom of the card,
 * Geist Mono 12 muted, 14px swatches, 16px apart, wraps. The swatches draw the same marks as the
 * plots (lib/analyse-marks.ts). Decorative: the words carry the meaning.
 */
export function Legend({ items }: { readonly items: readonly { readonly swatch: ReactNode; readonly label: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-12 text-text-muted" aria-label="Forklaring">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.swatch}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function Swatch({ width = 14, children }: { readonly width?: number; readonly children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${width} 14`} width={width} height={14} className="shrink-0">
      {children}
    </svg>
  );
}

/** eFTP · størrelse = TSS: three dot sizes. */
export function DotSizesSwatch() {
  return (
    <Swatch width={22}>
      <circle cx="2.5" cy="7" r="1.5" fill={AMARKS.line.color} />
      <circle cx="8.5" cy="7" r="2.5" fill={AMARKS.line.color} />
      <circle cx="17" cy="7" r="4" fill={AMARKS.line.color} />
    </Swatch>
  );
}

/** The 2px main line (EF trend). */
export function LineSwatch() {
  return (
    <Swatch>
      <line x1="0" x2="14" y1="7" y2="7" stroke={AMARKS.line.color} strokeWidth={AMARKS.line.width} />
    </Swatch>
  );
}

/** An EF ride: the small --shade-2 dot. */
export function RideDotSwatch() {
  return (
    <Swatch>
      <circle cx="7" cy="7" r={AMARKS.efRide.r} fill={AMARKS.efRide.color} />
    </Swatch>
  );
}

/** Excluded ride: the 7px ×. */
export function CrossSwatch() {
  const c = AMARKS.cross;
  const h = c.size / 2;
  return (
    <Swatch>
      <path d={`M${7 - h} ${7 - h}L${7 + h} ${7 + h}M${7 + h} ${7 - h}L${7 - h} ${7 + h}`} stroke={c.color} strokeWidth={c.width} fill="none" />
    </Swatch>
  );
}

/** A week bar (solid --text), a deload bar (hatched) or a zero week (the --axis stub). */
export function BarSwatch({ kind = "bar" }: { readonly kind?: "bar" | "deload" | "zero" }) {
  if (kind === "zero")
    return (
      <Swatch>
        <rect x="1" y={14 - AMARKS.stub.height} width="12" height={AMARKS.stub.height} fill={AMARKS.stub.color} />
      </Swatch>
    );
  if (kind === "deload")
    return (
      <Swatch>
        <defs>
          <pattern id="analyse-hatch" width={AMARKS.hatch.pitch} height={AMARKS.hatch.pitch} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" x2="0" y1="0" y2={AMARKS.hatch.pitch} stroke={AMARKS.hatch.color} strokeWidth="1" />
          </pattern>
        </defs>
        <rect x="3.5" y="2.5" width="7" height="11" fill="url(#analyse-hatch)" stroke={AMARKS.hatch.color} strokeWidth={AMARKS.hatch.outline} />
      </Swatch>
    );
  return (
    <Swatch>
      <rect x="3" y="2" width="8" height="12" rx={AMARKS.bar.radius} fill={AMARKS.bar.color} />
    </Swatch>
  );
}

/** I dag (Cykel only; Styrke has no today line since 2026-10-14): the 1.5px --today line (decorative; the word carries it). */
export function TodaySwatch() {
  return (
    <Swatch>
      <line x1="7" x2="7" y1="0" y2="14" stroke={AMARKS.today.color} strokeWidth={AMARKS.today.width} />
    </Swatch>
  );
}

/** Logged e1RM: filled --text dot. */
export function LoggedSwatch() {
  const m = AMARKS.e1rm.logged;
  return (
    <Swatch>
      <circle cx="7" cy="7" r={m.r} fill={m.fill} />
    </Swatch>
  );
}

/** Prescribed e1RM: hollow (estimate). */
export function PrescribedSwatch() {
  const m = AMARKS.e1rm.prescribed;
  return (
    <Swatch>
      <circle cx="7" cy="7" r={m.r} fill={m.fill} stroke={m.color} strokeWidth={m.stroke} />
    </Swatch>
  );
}

/** Block best: the 1×6 tick 3px above the point. */
export function BestSwatch() {
  const b = AMARKS.e1rm.best;
  const r = AMARKS.e1rm.logged.r;
  return (
    <Swatch>
      <rect x={7 - b.width / 2} y={14 - 2 * r - b.gap - b.height} width={b.width} height={b.height} fill={b.color} />
      <circle cx="7" cy={14 - r} r={r} fill={AMARKS.e1rm.logged.fill} />
    </Swatch>
  );
}

/** 1RM i arket (ikke testet): dashed 6 4. */
export function SheetSwatch() {
  const m = AMARKS.e1rm.sheet;
  return (
    <Swatch width={20}>
      <line x1="0" x2="20" y1="7" y2="7" stroke={m.color} strokeWidth={m.width} strokeDasharray={`${m.on} ${m.off}`} />
    </Swatch>
  );
}

/** Deload on the ruler: the bracket's dashed part with its end tick. */
export function DeloadBracketSwatch() {
  const m = AMARKS.bracket;
  return (
    <Swatch>
      <line x1="0" x2="13.5" y1="5" y2="5" stroke="var(--text-muted)" strokeWidth={m.width} strokeDasharray={`${m.on} ${m.off}`} />
      <line x1="13.5" x2="13.5" y1="5" y2={5 + m.tick} stroke="var(--text-muted)" strokeWidth={m.width} />
    </Swatch>
  );
}
