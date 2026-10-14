/**
 * Analyse-only chart marks (Ember reset: design/specs/reset-analyse-cykel.md §4 and
 * reset-analyse-styrke.md §4–§5). Cykel's and Styrke's cards read their sizes, dashes and colours
 * from here; Belastning's shared marks stay in chart-marks.ts.
 *
 * Pure: no React, no I/O. Units are CSS px. Colours are CSS variables by name, never hex.
 */

export const AMARKS = {
  /** Gridlines: 1px --border dashed 2 4 (decorative). */
  grid: { color: "var(--border)", dash: "2 4" },
  /** Strip and panel baseline. */
  baseline: { color: "var(--axis)" },
  /** Main line: eFTP through its points, the EF trend. */
  line: { width: 2, color: "var(--text)" },
  /** The latest eFTP ride: C's "you are here" ring. */
  latest: { r: 5, fill: "var(--card)", stroke: 2, color: "var(--text)" },
  /** EF per ride: a small filled secondary dot. */
  efRide: { r: 2.5, color: "var(--shade-2)" },
  /** Excluded ride: a 7px × of 1.5px lines on the plot's bottom edge (never hollow). */
  cross: { size: 7, width: 1.5, color: "var(--shade-2)" },
  /** Today: a 1.5px vertical line; `I DAG` 4px left of it. */
  today: { width: 1.5, color: "var(--today)", labelGap: 4 },
  /** Pause seam ("Ingen ture"): 1px dashed 3 3 --axis rules at both edges. */
  seam: { width: 1, on: 3, off: 3, color: "var(--axis)" },
  /** Week bars: solid --text, the slot minus 2px, top corners 2px. */
  bar: { gap: 2, radius: 2, color: "var(--text)" },
  /** A week with zero: a 2px --axis stub on the baseline. */
  stub: { height: 2, color: "var(--axis)" },
  /** Deload week: 1px --shade-2 diagonals every 4px on --card, 1px --shade-2 outline. */
  hatch: { color: "var(--shade-2)", pitch: 4, outline: 1 },
  /** Block ruler: 1px --axis bracket, 4px end ticks, the deload part dashed 2 3. */
  bracket: { width: 1, tick: 4, color: "var(--axis)", on: 2, off: 3, y: 14 },
  /** Phase change: a 1.5px solid --shade-2 rule. */
  phase: { width: 1.5, color: "var(--shade-2)" },
  e1rm: {
    logged: { r: 3.5, fill: "var(--text)" },
    prescribed: { r: 3, stroke: 1.5, color: "var(--text-muted)", fill: "var(--card)" },
    line: { width: 1.5, color: "var(--text-muted)" },
    best: { width: 1, height: 6, gap: 3, color: "var(--text)", labelSize: 11 },
    sheet: { width: 1, on: 6, off: 4, color: "var(--text-muted)" },
  },
} as const;

/** A dashed rule as a CSS background: `on` px of colour, `off` px gap, along `dir`. */
export function dashGradient(dir: "to right" | "to bottom", color: string, on: number, off: number): string {
  return `repeating-linear-gradient(${dir}, ${color} 0 ${on}px, transparent ${on}px ${on + off}px)`;
}

/** B's hatched deload bar: 1px diagonal lines every `pitch` px on --card. */
export function hatchGradient(color: string = AMARKS.hatch.color, pitch: number = AMARKS.hatch.pitch): string {
  return `repeating-linear-gradient(135deg, ${color} 0 1px, var(--card) 1px ${pitch}px)`;
}

type Span = { readonly x0: number; readonly x1: number };
type Block = Span & { readonly deloadX0: number | null };

/**
 * Whether a week slot lies in a block's deload part (from `deloadX0` to the block's end).
 * Drawing only: the deload span comes from the view (blocks.deload_start), nothing is computed.
 */
export function isDeloadWeek(week: Span, blocks: readonly Block[]): boolean {
  const mid = (week.x0 + week.x1) / 2;
  return blocks.some((b) => b.deloadX0 !== null && mid >= b.deloadX0 && mid < b.x1);
}

// --- x labels vs the `I DAG` caption (no label at today) -------------------------------------

/** An x label's text anchor: the first starts at its tick, one within 30 days of the end ends at it, others centred. */
export type TickAnchor = "start" | "middle" | "end";

export function tickAnchor(index: number, x: number, hi: number): TickAnchor {
  return index === 0 ? "start" : hi - x < 30 ? "end" : "middle";
}

/** Clear space between an x label and the `I DAG` caption's left edge (px): never touching. */
export const TODAY_CLEAR = 8;

/** Size of the x labels and the `I DAG` caption (Geist Mono 11). */
const LABEL_SIZE = 11;

/** Geist Mono's advance is 0.6 em, so a mono-11 label is 6.6px per character. */
export function monoWidth(text: string, size: number = LABEL_SIZE): number {
  return [...text].length * size * 0.6;
}

type Tick = { readonly x: number; readonly label: string };

/**
 * The x labels to draw: every tick except one whose label box reaches within TODAY_CLEAR px of the
 * `I DAG` caption (end-anchored `today.labelGap` px left of the today line) or of the line itself.
 * Anchors come from the full list, so dropping a label never moves another. `width` is the plot's
 * width in px (the x scale's range, y-label column excluded); `today` null = no caption, keep all.
 */
export function ticksClearOfToday<T extends Tick>(
  ticks: readonly T[],
  g: { readonly lo: number; readonly hi: number; readonly today: number | null; readonly width: number },
): T[] {
  if (g.today === null) return [...ticks];
  const px = (x: number) => ((x - g.lo) / (g.hi - g.lo)) * g.width;
  const line = px(g.today);
  const captionLeft = line - AMARKS.today.labelGap - monoWidth("I DAG");
  const blockedFrom = captionLeft - TODAY_CLEAR;
  const blockedTo = line + AMARKS.today.width / 2 + TODAY_CLEAR;
  return ticks.filter((t, i) => {
    const w = monoWidth(t.label);
    const anchor = tickAnchor(i, t.x, g.hi);
    const left = anchor === "start" ? px(t.x) : anchor === "end" ? px(t.x) - w : px(t.x) - w / 2;
    return left + w <= blockedFrom || left >= blockedTo;
  });
}
