import type { ReactElement, ReactNode } from "react";

import { bracketGeometry, MARKS } from "@/lib/chart-marks";

/**
 * Shared SVG marks (DESIGN.md Part B Revision 5; sizes from lib/chart-marks.ts). Pure and
 * prop-driven, no hooks, no "use client": they render inside a Recharts custom layer, a
 * Recharts `shape`, an inline SVG (Styrke) or a legend swatch alike. All aria-hidden by their
 * parent; the chart's figcaption / readout carries the words.
 */

type TodayTickProps = {
  readonly x: number;
  /** The baseline the tick sits on (the x axis, or the ruler's baseline). */
  readonly y: number;
  readonly height?: number;
  /** center: half above, half below the baseline; up: above it; down: below it. */
  readonly align?: "center" | "up" | "down";
};

/** The red "now" tick: 2px wide, --chart-today; 12px on /load's axis, 8 on Analyse, 28 on the ruler. */
export function TodayTick({ x, y, height = MARKS.todayTick.height.chart, align = "center" }: TodayTickProps) {
  const w = MARKS.todayTick.width;
  const top = align === "up" ? y - height : align === "down" ? y : y - height / 2;
  return <rect x={x - w / 2} y={top} width={w} height={height} fill={MARKS.todayTick.color} />;
}

/** /load's full-height dotted today rule (1px, dotted 1 3, muted). */
export function TodayRule({ x, y0, y1 }: { readonly x: number; readonly y0: number; readonly y1: number }) {
  const m = MARKS.todayRule;
  return <line x1={x} x2={x} y1={y0} y2={y1} stroke={m.color} strokeWidth={m.width} strokeDasharray={m.dash} />;
}

/** A pause seam edge: 1px dashed 3 3 muted, full height. */
export function SeamRule({ x, y0, y1 }: { readonly x: number; readonly y0: number; readonly y1: number }) {
  const m = MARKS.seam;
  return <line x1={x} x2={x} y1={y0} y2={y1} stroke={m.color} strokeWidth={m.width} strokeDasharray={m.dash} />;
}

/** Styrke's phase change: 1px solid ink rule, full height. */
export function PhaseRule({ x, y0, y1 }: { readonly x: number; readonly y0: number; readonly y1: number }) {
  const m = MARKS.phaseRule;
  return <line x1={x} x2={x} y1={y0} y2={y1} stroke={m.color} strokeWidth={m.width} />;
}

type BlockBracketProps = {
  /** Block start and end in px (ongoing: end = lastActual). */
  readonly x0: number;
  readonly x1: number;
  /** Where the deload part starts, px; null = no deload in view. */
  readonly deloadX0: number | null;
  /** The bracket line's y; the end ticks hang 6px down from it. */
  readonly y: number;
  /** Already fitted with `bracketLabel` (null = omitted); drawn centred, 4px above the line. */
  readonly label?: string | null;
};

/** A strength block as a hairline bracket: 1px line, 6px down-ticks at both ends, deload dashed 3 2. */
export function BlockBracket({ x0, x1, deloadX0, y, label = null }: BlockBracketProps) {
  const m = MARKS.bracket;
  const g = bracketGeometry(x0, x1, deloadX0);
  return (
    <g>
      {g.solid !== null && <line x1={g.solid.x0} x2={g.solid.x1} y1={y} y2={y} stroke={m.color} strokeWidth={m.width} />}
      {g.deload !== null && (
        <line
          x1={g.deload.x0}
          x2={g.deload.x1}
          y1={y}
          y2={y}
          stroke={m.color}
          strokeWidth={m.width}
          strokeDasharray={m.deloadDash}
        />
      )}
      {g.ticks.map((tx, i) => (
        <line
          key={i}
          // Inset half a stroke so an end tick on the plot edge is not cut in half.
          x1={tx + (i === 0 ? m.width / 2 : -m.width / 2)}
          x2={tx + (i === 0 ? m.width / 2 : -m.width / 2)}
          y1={y}
          y2={y + m.endTick}
          stroke={m.color}
          strokeWidth={m.width}
        />
      ))}
      {label !== null && (
        <text
          x={g.mid}
          y={y - m.label.gap}
          textAnchor="middle"
          fill={m.label.color}
          fontSize={m.label.size}
          className="font-mono"
        >
          {label}
        </text>
      )}
    </g>
  );
}

/** An excluded ride: a 6px × of two 1px muted lines, centred on (cx, cy). Never hollow. */
export function ExcludedCross({ cx, cy, size = MARKS.excluded.size }: { readonly cx: number; readonly cy: number; readonly size?: number }) {
  const h = size / 2;
  const m = MARKS.excluded;
  return (
    <path d={`M${cx - h} ${cy - h}L${cx + h} ${cy + h}M${cx + h} ${cy - h}L${cx - h} ${cy + h}`} stroke={m.color} strokeWidth={m.width} fill="none" />
  );
}

/** A filled dot with an optional --bg ring (today's values, the latest eFTP ride). */
export function RingedDot({ cx, cy, r, fill = "var(--text)", ring = MARKS.todayValue.ring }: { readonly cx: number; readonly cy: number; readonly r: number; readonly fill?: string; readonly ring?: number }) {
  return (
    <g>
      {ring > 0 && <circle cx={cx} cy={cy} r={r + ring} fill="var(--bg)" />}
      <circle cx={cx} cy={cy} r={r} fill={fill} />
    </g>
  );
}

/** A hollow dot (estimated or missing): stroke 1, no fill. */
export function HollowDot({ cx, cy, r, stroke = "var(--text)", strokeWidth = 1 }: { readonly cx: number; readonly cy: number; readonly r: number; readonly stroke?: string; readonly strokeWidth?: number }) {
  return <circle cx={cx} cy={cy} r={r} fill="none" stroke={stroke} strokeWidth={strokeWidth} />;
}

// --- Recharts custom shapes ---------------------------------------------------------------------
// Recharts calls a `shape` function with the point's props; only the geometry is read here.

/** What a Recharts `<Scatter shape>` passes that these shapes read (cx/cy may be missing). */
export type PointShapeProps = { readonly cx?: number; readonly cy?: number };
/** What a Recharts `<Bar shape>` passes that the needle reads. */
export type BarShapeProps = { readonly x?: number; readonly y?: number; readonly width?: number; readonly height?: number };

const EMPTY = <g />;

/**
 * A CTL/ATL day tick for `<Scatter shape={dayTickShape(MARKS.ctl.thickness, dayTickWidth(pitch))}>`:
 * a horizontal ink dash centred on the day's value.
 */
export function dayTickShape(thickness: number, width: number, color: string = "var(--text)") {
  return function DayTick({ cx, cy }: PointShapeProps): ReactElement {
    if (cx === undefined || cy === undefined || !Number.isFinite(cx) || !Number.isFinite(cy)) return EMPTY;
    return <rect x={cx - width / 2} y={cy - thickness / 2} width={width} height={thickness} fill={color} />;
  };
}

/** A prognose hollow dot for `<Scatter shape={hollowDotShape(MARKS.ctl.prognose.r)}>`. */
export function hollowDotShape(r: number, stroke: string = "var(--text)", strokeWidth = 1) {
  return function HollowDotShape({ cx, cy }: PointShapeProps): ReactElement {
    if (cx === undefined || cy === undefined || !Number.isFinite(cx) || !Number.isFinite(cy)) return EMPTY;
    return <HollowDot cx={cx} cy={cy} r={r} stroke={stroke} strokeWidth={strokeWidth} />;
  };
}

/** A filled dot for `<Scatter shape={dotShape(r, fill)}>` (EF rides, EF trend, logged e1RM). */
export function dotShape(r: number, fill: string = "var(--text)") {
  return function DotShape({ cx, cy }: PointShapeProps): ReactElement {
    if (cx === undefined || cy === undefined || !Number.isFinite(cx) || !Number.isFinite(cy)) return EMPTY;
    return <circle cx={cx} cy={cy} r={r} fill={fill} />;
  };
}

/**
 * The TSB needle for `<Bar dataKey="tsb" barSize={1} shape={needleShape(prognose)}>`: a 1px ink
 * line from 0 to the value; prognose = the same line dashed 1 2 (an outline, no fill).
 */
export function needleShape(prognose: boolean, color: string = "var(--text)") {
  return function Needle({ x, y, width, height }: BarShapeProps): ReactElement {
    if (x === undefined || y === undefined || width === undefined || height === undefined) return EMPTY;
    if (![x, y, width, height].every(Number.isFinite) || height === 0) return EMPTY;
    const cx = x + width / 2;
    // Recharts gives a negative height for a bar below 0; the line covers [y, y + height] either way.
    return (
      <line
        x1={cx}
        x2={cx}
        y1={y}
        y2={y + height}
        stroke={color}
        strokeWidth={MARKS.tsb.width}
        strokeDasharray={prognose ? MARKS.tsb.prognoseDash : undefined}
      />
    );
  };
}

// --- Legend swatches (24×12, aria-hidden; the label next to it names the mark) -------------------

const SWATCH = "h-3 w-6 shrink-0";

function Swatch({ children }: { readonly children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 12" className={SWATCH}>
      {children}
    </svg>
  );
}

/** A horizontal day tick (CTL 3px, ATL 1.5px): two dashes, as on the plot. */
export function TickSwatch({ thickness }: { readonly thickness: number }) {
  return (
    <Swatch>
      <rect x="2" y={6 - thickness / 2} width="9" height={thickness} fill="var(--text)" />
      <rect x="13" y={6 - thickness / 2} width="9" height={thickness} fill="var(--text)" />
    </Swatch>
  );
}

/** TSB needles from a zero line (dashed when prognose). */
export function NeedleSwatch({ prognose = false }: { readonly prognose?: boolean }) {
  const dash = prognose ? MARKS.tsb.prognoseDash : undefined;
  return (
    <Swatch>
      <line x1="4" x2="20" y1="7.5" y2="7.5" stroke={MARKS.zeroLine.color} strokeWidth="1" />
      {[7, 12, 17].map((x, i) => (
        <line key={x} x1={x + 0.5} x2={x + 0.5} y1={i === 1 ? 1 : 3} y2="7.5" stroke="var(--text)" strokeWidth="1" strokeDasharray={dash} />
      ))}
    </Swatch>
  );
}

/** Hollow dots: the prognose (estimated) marks. */
export function HollowDotSwatch({ r = MARKS.ctl.prognose.r }: { readonly r?: number }) {
  return (
    <Swatch>
      <HollowDot cx={7} cy={6} r={r} />
      <HollowDot cx={17} cy={6} r={r} />
    </Swatch>
  );
}

/** Filled dots (EF rides muted; EF trend small ink). */
export function DotSwatch({ r, fill = "var(--text)" }: { readonly r: number; readonly fill?: string }) {
  return (
    <Swatch>
      <circle cx="7" cy="6" r={r} fill={fill} />
      <circle cx="17" cy="6" r={r} fill={fill} />
    </Swatch>
  );
}

/** eFTP's size legend: three dot sizes (small, middle, large TSS). */
export function DotSizesSwatch() {
  const m = MARKS.eftpDot;
  return (
    <svg aria-hidden="true" viewBox="0 0 32 12" className="h-3 w-8 shrink-0">
      <circle cx="3" cy="6" r={m.rMin} fill={m.fill} />
      <circle cx="12" cy="6" r={(m.rMin + m.rMax) / 2} fill={m.fill} />
      <circle cx="25" cy="6" r={m.rMax} fill={m.fill} />
    </svg>
  );
}

/** A block bracket (deload: dashed). */
export function BracketSwatch({ deload = false }: { readonly deload?: boolean }) {
  return (
    <Swatch>
      <BlockBracket x0={1} x1={23} deloadX0={deload ? 1 : null} y={3.5} />
    </Swatch>
  );
}

/** The excluded-ride ×. */
export function CrossSwatch() {
  return (
    <Swatch>
      <ExcludedCross cx={12} cy={6} />
    </Swatch>
  );
}

/** A weekly 2px bar on a baseline; `zero` draws the 1×2 stub instead. */
export function BarSwatch({ zero = false }: { readonly zero?: boolean }) {
  const s = MARKS.zeroStub;
  return (
    <Swatch>
      <line x1="4" x2="20" y1="11.5" y2="11.5" stroke={MARKS.zeroLine.color} strokeWidth="1" />
      {zero ? (
        <rect x={12 - s.width / 2} y={11 - s.height} width={s.width} height={s.height} fill={s.color} />
      ) : (
        <rect x={12 - MARKS.weekBar.width / 2} y="1" width={MARKS.weekBar.width} height="10" fill={MARKS.weekBar.color} />
      )}
    </Swatch>
  );
}

/** The red today tick on a baseline. */
export function TodayTickSwatch() {
  return (
    <Swatch>
      <line x1="4" x2="20" y1="6.5" y2="6.5" stroke={MARKS.zeroLine.color} strokeWidth="1" />
      <TodayTick x={12} y={6.5} height={12} />
    </Swatch>
  );
}

/** The CTL band's range comb: 1px muted vertical ticks. */
export function CombSwatch() {
  const m = MARKS.rangeComb;
  return (
    <Swatch>
      {[5, 12, 19].map((x) => (
        <line key={x} x1={x + 0.5} x2={x + 0.5} y1="1" y2="11" stroke={m.color} strokeWidth={m.width} />
      ))}
    </Swatch>
  );
}
