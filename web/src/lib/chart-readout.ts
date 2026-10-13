/**
 * Pure helpers for the charts' readout row and pointer tooltip (DESIGN.md "Charts: interaction").
 * No React: the components (components/ChartReadout.tsx) render what these return.
 */

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

/** Plain text of a readout, for the throttled aria-live region. */
export function readoutText(r: Readout): string {
  const cells = r.cells.map((c) => `${c.label} ${c.value === MISSING ? "ikke registreret" : c.value}${c.sr !== undefined && c.value !== MISSING ? c.sr : ""}`);
  return [r.head, cells.join(", "), ...r.facts].filter((s) => s !== "").join(". ");
}
