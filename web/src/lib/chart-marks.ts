/**
 * Every chart mark form, in one constant (DESIGN.md Part B Revision 5 "Chart marks"; specs
 * design/specs/instrument-load.md §2–§3 and instrument-analyse.md §1–§3). Every chart and legend
 * reads its sizes, dashes and colours from here, so Belastning, Cykel and Styrke draw the same
 * tick, needle, dot, bracket and × and a change lands everywhere at once.
 *
 * Pure: no React, no I/O. Units are SVG user units (= CSS px at 1:1). Colours are CSS variables
 * by name (globals.css :root), never hex.
 */

const INK = "var(--text)";
const MUTED = "var(--chart-mark)"; // = --text-muted
const TODAY = "var(--chart-today)"; // = --accent: the "today" tick only

export const MARKS = {
  /** Fitness: a 1px solid ink line over the measured days (user, 2026-10-14: lines read as a trend); prognose = hollow dots r 2, stroke 1. */
  ctl: { color: "var(--series-ctl)", width: 1, dash: undefined, prognose: { r: 2, stroke: 1 } },
  /** Fatigue: a 1px dashed (4 3) ink line; prognose = hollow dots r 1.5, stroke 1. */
  atl: { color: "var(--series-atl)", width: 1, dash: "4 3", prognose: { r: 1.5, stroke: 1 } },
  /** Form: a 1px needle from 0 per day; prognose = the same needle as a 1px dashed (1 2) outline. */
  tsb: { color: "var(--series-tsb)", width: 1, prognoseDash: "1 2" },
  /** Prognose dots: every 2nd day below lg, every day from lg. */
  prognoseEvery: { narrow: 2, wide: 1 },
  /** Today's measured CTL/ATL values: filled ink r 3 with a 2px --bg ring. */
  todayValue: { r: 3, fill: INK, ring: 2, ringColor: "var(--bg)" },
  /** CTL band after the block: a 1px vertical range tick ctl_low → ctl_high every 4th day (no area). */
  rangeComb: { width: 1, color: MUTED, everyDays: 4 },
  /** Zero line on /load and every strip baseline that carries meaning. */
  zeroLine: { width: 1, color: MUTED },
  /** Strength block: 1px line with 6px down-ticks at both ends; the deload part dashed 3 2. */
  bracket: {
    width: 1,
    endTick: 6,
    deloadDash: "3 2",
    color: MUTED,
    label: { size: 12, color: MUTED, gap: 4 },
    /** Annotation strip height above the plot. */
    strip: { load: 24, analyse: 18 },
  },
  /** Styrke's phase change: a 1px solid ink rule, full height. */
  phaseRule: { width: 1, color: INK },
  /** The red "now" tick (Part B signature 1), 2px wide; height per context. */
  todayTick: { width: 2, color: TODAY, height: { chart: 12, analyse: 8, ruler: 28 } },
  /** /load's full-height today rule: 1px dotted. */
  todayRule: { width: 1, dash: "1 3", color: MUTED },
  /** Pause seam ("Ingen ture"): 1px dashed rules at both edges. */
  seam: { width: 1, dash: "3 3", color: MUTED },
  /** Excluded ride: a 6px × of two 1px lines on the plot's bottom edge (never hollow). */
  excluded: { size: 6, width: 1, color: MUTED },
  /** Weekly hours / load / tonnage: one 2px ink bar at the slot centre. */
  weekBar: { width: 2, color: INK },
  /** A week with zero: a 1×2 stub on the baseline. Null: no mark. */
  zeroStub: { width: 1, height: 2, color: MUTED },
  /** eFTP per ride, area ∝ TSS: r = 1.5 + 4.5 × √(load / maxLoad), 1.5–6; null load = hollow ring. */
  eftpDot: { rMin: 1.5, rSpan: 4.5, rMax: 6, fill: INK, missing: { r: 3, stroke: 1 }, latestRing: 2 },
  /** EF: each ride a muted dot; the 28-day trend as small ink dots (no line). */
  efRide: { r: 2, color: MUTED },
  efTrend: { r: 1.25, color: INK },
  /** e1RM: logged filled ink, prescribed hollow muted (estimated = hollow, app-wide). */
  e1rm: {
    logged: { r: 3, fill: INK },
    prescribed: { r: 2.5, stroke: 1, color: MUTED },
    line: { width: 1, color: MUTED },
    /** Block best: a 1×6 ink tick 3px above the point, its value mono 12 above that. */
    best: { width: 1, height: 6, gap: 3, color: INK, labelSize: 12 },
    /** The sheet's (untested) 1RM: dashed 6 4. */
    sheet: { width: 1, dash: "6 4", color: MUTED, labelSize: 12 },
  },
  /** Selection marker (unchanged): a 1px ink rule. */
  marker: { width: 1, color: INK },
} as const;

/** Every n-th prognose day carries a hollow dot: 2 below lg, 1 from lg. */
export function prognoseEvery(wide: boolean): number {
  return wide ? MARKS.prognoseEvery.wide : MARKS.prognoseEvery.narrow;
}

/** Whether the k-th day (0-based, counted from the first band day) gets a range-comb tick. */
export function isCombDay(k: number): boolean {
  return Number.isInteger(k) && k >= 0 && k % MARKS.rangeComb.everyDays === 0;
}

export type EftpDot = { readonly r: number; readonly hollow: boolean };

/**
 * eFTP dot radius from the ride's TSS: r = 1.5 + 4.5 × √(load / maxLoad), clamped to 1.5–6.
 * A null load is "missing", not small: the hollow ring's r 3 (draw it with `eftpDot`).
 * maxLoad ≤ 0 or not finite (no ride has a load): every dot gets rMin.
 */
export function eftpDotRadius(load: number | null, maxLoad: number): number {
  const m = MARKS.eftpDot;
  if (load === null || !Number.isFinite(load)) return m.missing.r;
  if (!Number.isFinite(maxLoad) || maxLoad <= 0) return m.rMin;
  const share = Math.min(1, Math.max(0, load / maxLoad));
  return Math.min(m.rMax, Math.max(m.rMin, m.rMin + m.rSpan * Math.sqrt(share)));
}

/** The eFTP dot's radius and form: filled by TSS, or a hollow ring when the ride has no TSS. */
export function eftpDot(load: number | null, maxLoad: number): EftpDot {
  return { r: eftpDotRadius(load, maxLoad), hollow: load === null || !Number.isFinite(load) };
}

/** The largest finite load of the plotted rides (the eFTP size scale's 100 %), 0 when none. */
export function maxLoadOf(loads: readonly (number | null)[]): number {
  return loads.reduce<number>((max, l) => (l !== null && Number.isFinite(l) && l > max ? l : max), 0);
}

export type BracketGeometry = {
  /** The solid line, x0 → (deload start or x1). */
  readonly solid: { readonly x0: number; readonly x1: number } | null;
  /** The dashed deload part, deload start → x1; null without a deload in view. */
  readonly deload: { readonly x0: number; readonly x1: number } | null;
  /** The 6px end ticks (both ends of the whole bracket). */
  readonly ticks: readonly [number, number];
  /** Label anchor (centre of the bracket) and the bracket's width. */
  readonly mid: number;
  readonly width: number;
};

/**
 * A block bracket from x0 to x1 (px, any order), with the deload part from `deloadX0` dashed.
 * A deload start outside the bracket is clamped into it; at or before x0 the whole bracket is
 * dashed (solid = null), at or after x1 there is no dashed part.
 */
export function bracketGeometry(x0: number, x1: number, deloadX0: number | null): BracketGeometry {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  const d = deloadX0 === null || !Number.isFinite(deloadX0) ? null : Math.min(hi, Math.max(lo, deloadX0));
  const split = d === null || d >= hi ? hi : d;
  return {
    solid: split > lo ? { x0: lo, x1: split } : null,
    deload: split < hi ? { x0: split, x1: hi } : null,
    ticks: [lo, hi],
    mid: (lo + hi) / 2,
    width: hi - lo,
  };
}

/** Chivo Mono's advance is 0.6 em, so a mono-12 label is 7.2px per character. */
const MONO_ADVANCE_EM = 0.6;

/** A mono label's width in px at `size` (default the bracket's 12px). */
export function monoLabelWidth(label: string, size: number = MARKS.bracket.label.size): number {
  return [...label].length * size * MONO_ADVANCE_EM;
}

/**
 * The bracket label to draw, or null when the bracket is narrower than the label (+ 4px each
 * side): omitted, never clipped. The caller picks the form: `B12` below 640px, `Blok 12` above.
 */
export function bracketLabel(width: number, label: string): string | null {
  return monoLabelWidth(label) <= width - 2 * MARKS.bracket.label.gap ? label : null;
}
