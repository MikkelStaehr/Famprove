/**
 * Pure helpers for the charts' readout row and pointer tooltip (DESIGN.md "Charts: interaction").
 * No React: the components (components/ChartReadout.tsx) render what these return.
 */

import type { BlockSpan, ChartPoint } from "./dashboard-view.ts";
import { formatDay, formatLoad, formatSigned, stopAfter } from "./format.ts";

/** One value cell on line 2: the series' swatch (by key), its label in --text-muted, then the value. */
export type ReadoutCell = {
  readonly key: string; // a SeriesKey on /load; otherwise a stable id (no swatch)
  readonly label: string;
  readonly value: string; // "–" for a missing value (spoken via sr)
  readonly warning?: boolean; // --warning + triangle (VI on a Z2 day)
  readonly sr?: string; // extra screen-reader text after the value
};

/** Line 1 (date · status), line 2 (cells, may be empty), then fact lines. */
export type Readout = {
  readonly head: string;
  readonly cells: readonly ReadoutCell[];
  readonly facts: readonly string[];
  readonly muted?: boolean; // the "Tryk på grafen …" empty rest state
  readonly factTone?: "text"; // Styrke: the lift lines are lines 2+ in --text, not muted facts
};

export const REST_PREFIX = "Seneste · ";
export const MISSING = "–";

/** At rest: the latest point with "Seneste · " in front; never blank. */
export function restingReadout(latest: Readout | null, empty: string): Readout {
  if (latest === null) return { head: empty, cells: [], facts: [], muted: true };
  return { ...latest, head: `${REST_PREFIX}${latest.head}` };
}

/** Index of the x nearest to `x` in an ascending list; ties go left; -1 when empty. */
export function nearestIndex(xs: readonly number[], x: number): number {
  if (xs.length === 0) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && x - xs[lo - 1] <= xs[lo] - x) return lo - 1;
  return lo;
}

/** Data x under a pointer, from the plot box and its left/right insets (Recharts' linear x scale). */
export function xAtPointer(
  clientX: number,
  box: { readonly left: number; readonly width: number },
  inset: { readonly left: number; readonly right: number },
  domain: { readonly lo: number; readonly hi: number },
): number {
  const f = (clientX - box.left - inset.left) / (box.width - inset.left - inset.right);
  return domain.lo + Math.max(0, Math.min(1, f)) * (domain.hi - domain.lo);
}

/**
 * Left edge (px, plot-relative) of the pointer tooltip: 12px right of the marker, flipped to 12px
 * left of it when it would cross the plot's right edge, so it never covers the marker or the point.
 */
export function tipLeft(marker: number, tipWidth: number, plotRight: number, gap = 12): number {
  const right = marker + gap;
  if (right + tipWidth <= plotRight) return right;
  return Math.max(0, marker - gap - tipWidth);
}

const VI_FORMAT = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The VI cell on the eFTP readout: "VI 1,08"; flagged in --warning; "VI –" when missing (the cell stays). */
export function viCell(vi: number | null, warning: boolean | null): ReadoutCell {
  if (vi === null) return { key: "vi", label: "VI", value: MISSING, sr: "ikke registreret" };
  return warning === true
    ? { key: "vi", label: "VI", value: VI_FORMAT.format(vi), warning: true, sr: ", ujævn effekt på en Z2-dag" }
    : { key: "vi", label: "VI", value: VI_FORMAT.format(vi) };
}

/** Plain text of a readout, for the throttled aria-live region; a part ending in "okt." gets no second stop. */
export function readoutText(r: Readout): string {
  const cells = r.cells.map((c) => `${c.label} ${c.value === MISSING ? "ikke registreret" : c.value}${c.sr !== undefined && c.value !== MISSING ? c.sr : ""}`);
  const parts = [r.head, cells.join(", "), ...r.facts].filter((s) => s !== "");
  return parts.map((s, i) => (i === parts.length - 1 ? s : `${s}${stopAfter(s)}`)).join(" ");
}

/**
 * The week a weekly chart reads at rest (and ←/→ start from): the current week once it has data,
 * else the latest week before it that has; the current (or last) week when none has. -1 when empty.
 */
export function restingWeekIndex<W extends { readonly current: boolean }>(
  weeks: readonly W[],
  hasData?: (w: W) => boolean,
): number {
  const current = weeks.findIndex((w) => w.current);
  const end = current >= 0 ? current : weeks.length - 1;
  if (hasData === undefined) return end;
  for (let i = end; i >= 0; i -= 1) {
    const w = weeks[i];
    if (w !== undefined && hasData(w)) return i;
  }
  return end;
}

/** Two marks on one x (two rides on one day): the one with the highest value; a null value never wins. */
export function highestAt(xs: readonly number[], ys: readonly (number | null)[], i: number): number {
  let best = i;
  for (let j = 0; j < xs.length; j += 1) {
    if (xs[j] !== xs[i]) continue;
    const y = ys[j];
    const b = ys[best];
    if (y !== null && (b === null || y > b)) best = j;
  }
  return best;
}

/**
 * DESIGN.md "Gaps": the index of the seam the pointer x lies in when the nearest point is more
 * than `maxDays` away (the marker stays at the tap and line 1 reads the seam); otherwise -1.
 */
export function gapSeam(
  x: number,
  nearestX: number | undefined,
  seams: readonly { readonly x0: number; readonly x1: number }[],
  maxDays = 14,
): number {
  if (nearestX !== undefined && Math.abs(nearestX - x) <= maxDays) return -1;
  return seams.findIndex((s) => s.x0 <= x && x < s.x1);
}

/**
 * /load's fitness-curve readout (DESIGN.md readout): date (+ prognose status), Fitness · Træthed ·
 * Form, then one line: block (· spænd on a prognose day). Every value is the stored one (a prognose
 * day's Form is daily_projection.tsb as-is, never Fitness − Træthed recomputed here).
 */
export function curveReadout(p: ChartPoint, blocks: readonly BlockSpan[]): Readout {
  const block = blocks.find((b) => b.start <= p.date && p.date <= b.end);
  const deload = block !== undefined && block.deloadStart !== null && block.deloadStart <= p.date;
  // The bracket's short label (`Blok 12`), so block · deload · spænd stays one line at 390px.
  const blockFact = block === undefined ? [] : [`Blok ${block.blockNo}${deload ? " · deload" : ""}`];
  if (p.kind === "projected") {
    // One fact line (polish 2026-10-14): block · the fitness span. The prognose basis (cycling's typical
    // day, strength sessions and their estimated day) lives in the card foot, not per day.
    const span = p.bands?.ctl;
    const spanFact = span != null && formatLoad(span.low) !== formatLoad(span.high) ? [`spænd ${formatLoad(span.low)}–${formatLoad(span.high)}`] : [];
    const fact = [...blockFact, ...spanFact].join(" · ");
    return {
      head: `${formatDay(p.date)} · Prognose${p.estimate?.strengthMethod === "recent" ? " · efter blokken" : ""}`,
      cells: [
        // No "≈ " per cell: line 1 says Prognose, and with it the cells wrapped to two lines at 390px.
        { key: "ctl", label: "Fitness", value: formatLoad(p.ctl) },
        { key: "atl", label: "Træthed", value: formatLoad(p.atl) },
        { key: "tsb", label: "Form", value: formatSigned(p.tsb) },
      ],
      facts: fact === "" ? [] : [fact],
    };
  }
  return {
    head: formatDay(p.date),
    cells: [
      { key: "ctl", label: "Fitness", value: Number.isFinite(p.ctl) ? formatLoad(p.ctl) : MISSING },
      { key: "atl", label: "Træthed", value: formatLoad(p.atl) },
      { key: "tsb", label: "Form", value: formatSigned(p.tsb) },
    ],
    facts: blockFact,
  };
}
