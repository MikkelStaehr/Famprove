/**
 * Belastning's day charts (design/specs/reset-belastning.md §3–§5): the training-day grid's shade
 * buckets, the before-the-strength-log rule, the daily TSS bars' windows and the fitness curve's
 * ranges and gridlines. Pure: no React, no I/O.
 *
 * Every value shown comes from daily_load / daily_projection as-is. The only numbers made here are
 * DRAWING scales (shade bucket, bar height top, gridline steps, window dates): never a figure the
 * user reads as a measurement.
 */
import { addDays, isoWeekStart } from "./dates.ts";
import type { IsoDate } from "./db/rows.ts";

/** One daily_load day's TSS (Python's values). */
export type DayLoad = {
  readonly date: IsoDate;
  readonly cyclingTss: number;
  readonly strengthTss: number;
  readonly totalTss: number;
};

/** Shade level of a day: 0 rest (--track), 1 (--shade-1), 2 (--shade-2), 3 (--text). */
export type ShadeLevel = 0 | 1 | 2 | 3;

/** §4's fixed thresholds on total TSS, as displayed (whole TSS): 0 · 1–49 · 50–99 · 100+. */
export const SHADE_STEPS = [1, 50, 100] as const;

/** The grid's shade bucket for a day's total TSS (drawing scale; not computed per window). */
export function shadeLevel(totalTss: number): ShadeLevel {
  const t = Math.round(totalTss);
  if (t < SHADE_STEPS[0]) return 0;
  if (t < SHADE_STEPS[1]) return 1;
  if (t < SHADE_STEPS[2]) return 2;
  return 3;
}

/** The strength log's first day: the earliest blocks.start_date (a selection, no maths); null without blocks. */
export function strengthLogStart(blocks: readonly { readonly startDate: IsoDate }[]): IsoDate | null {
  let first: IsoDate | null = null;
  for (const b of blocks) if (first === null || b.startDate < first) first = b.startDate;
  return first;
}

/**
 * One day as the grid and the bars read it. `strength` null = not registered (before the log);
 * `unknown` = no ride and strength not registered (or no daily_load row): never drawn as rest.
 */
export type DayCell = {
  readonly date: IsoDate;
  readonly cycling: number | null;
  readonly strength: number | null;
  readonly total: number | null;
  readonly level: ShadeLevel | null; // null when unknown
  readonly unknown: boolean;
  readonly beforeLog: boolean;
};

/** A day by §4's rule: before the log a day with a ride is shaded by its (cycling-only) total, else unknown. */
export function dayCell(date: IsoDate, row: DayLoad | undefined, logStart: IsoDate | null): DayCell {
  const beforeLog = logStart === null || date < logStart;
  if (row === undefined) {
    return { date, cycling: null, strength: null, total: null, level: null, unknown: true, beforeLog };
  }
  if (beforeLog) {
    const rode = Math.round(row.cyclingTss) > 0;
    return {
      date,
      cycling: row.cyclingTss,
      strength: null,
      total: rode ? row.totalTss : null,
      level: rode ? shadeLevel(row.totalTss) : null,
      unknown: !rode,
      beforeLog,
    };
  }
  return {
    date,
    cycling: row.cyclingTss,
    strength: row.strengthTss,
    total: row.totalTss,
    level: shadeLevel(row.totalTss),
    unknown: false,
    beforeLog,
  };
}

export const GRID_WEEKS = 12;

/** One ISO week column, Mon → Sun; `null` = a day after today (not drawn). */
export type GridWeek = {
  readonly weekStart: IsoDate;
  readonly days: readonly (DayCell | null)[];
};

/** The 12 ISO weeks ending with today's week, Mon → Sun; days after today are null. */
export function gridWeeks(days: readonly DayLoad[], today: IsoDate, logStart: IsoDate | null): GridWeek[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const last = isoWeekStart(today);
  return Array.from({ length: GRID_WEEKS }, (_, w) => {
    const weekStart = addDays(last, (w - GRID_WEEKS + 1) * 7);
    return {
      weekStart,
      days: Array.from({ length: 7 }, (_, d) => {
        const date = addDays(weekStart, d);
        return date > today ? null : dayCell(date, byDate.get(date), logStart);
      }),
    };
  });
}

/** The bars' window: today − (n − 1) … today, one DayCell per day. */
export function barDays(days: readonly DayLoad[], today: IsoDate, n: number, logStart: IsoDate | null): DayCell[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(today, i - n + 1);
    return dayCell(date, byDate.get(date), logStart);
  });
}

/** The bars' height scale: the window's largest total rounded up to 50 (drawing only); 50 when empty. */
export function barTop(cells: readonly DayCell[]): number {
  const max = cells.reduce((m, c) => (c.total !== null && c.total > m ? c.total : m), 0);
  return Math.max(50, Math.ceil(max / 50) * 50);
}

/** The run of days before the strength log inside a window: [first index, last index], or null. */
export function beforeLogSpan(cells: readonly DayCell[]): readonly [number, number] | null {
  const first = cells.findIndex((c) => c.beforeLog);
  if (first === -1) return null;
  let last = first;
  while (last + 1 < cells.length && cells[last + 1].beforeLog) last += 1;
  return [first, last];
}

export type CurveRange = "4U" | "12U" | "season";

/** §3's ranges: history days back from today (null = the whole series) and prognose days shown. */
export const CURVE_RANGE: Readonly<Record<CurveRange, { readonly back: number | null; readonly forward: number }>> = {
  "4U": { back: 27, forward: 14 },
  "12U": { back: 83, forward: 28 },
  season: { back: null, forward: 56 },
};

/** The curve window [from, to] for a range; `seriesStart` is the first daily_load date. */
export function curveWindow(range: CurveRange, today: IsoDate, seriesStart: IsoDate): { readonly from: IsoDate; readonly to: IsoDate } {
  const r = CURVE_RANGE[range];
  const back = r.back === null ? seriesStart : addDays(today, -r.back);
  return { from: back < seriesStart ? seriesStart : back, to: addDays(today, r.forward) };
}

/** fitness-round.md §1: the most intervals the curve's y axis may have. */
export const CURVE_MAX_INTERVALS = 4;

/** The step candidates 1, 2, 5, 10, 20, 50, 100, … in order. */
function* niceSteps(): Generator<number> {
  for (let p = 1; ; p *= 10) for (const m of [1, 2, 5]) yield m * p;
}

/**
 * The curve's y scale (drawing only; fitness-round.md §1, user 2026-10-14): the first step in 1,
 * 2, 5, 10, 20, … that gives ≤ 4 intervals; bottom `lo` = the whole number at or below the window's
 * lowest value (never below 0), so the axis starts at the data; top = the smallest step multiple
 * ≥ the highest. `lines` holds the step multiples inside [lo, hi], one gridline and label each (the
 * first can sit above the axis, e.g. lo 9 with lines from 10).
 */
export function curveScale(min: number, max: number): { readonly lo: number; readonly hi: number; readonly step: number; readonly lines: readonly number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new RangeError("curveScale: min and max must be finite");
  const a = Math.max(0, Math.min(min, max));
  const b = Math.max(0, min, max);
  for (const step of niceSteps()) {
    const first = Math.floor(a / step) * step;
    const top = Math.ceil(b / step) * step;
    const hi = top > first ? top : first + step;
    if ((hi - first) / step <= CURVE_MAX_INTERVALS) {
      // The axis starts at the data, not at the step below it (user, 2026-10-14: no empty area
      // under the lowest value): the whole number at or below the minimum; the gridlines stay on
      // the step's multiples inside [lo, hi].
      const lo = Math.min(Math.floor(a), hi - 1);
      const lines: number[] = [];
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) lines.push(v);
      return { lo, hi, step, lines };
    }
  }
  throw new Error("unreachable: the step candidates are unbounded");
}

/**
 * review-round.md §2: the fitness curve's vertices, picked from Python's daily series (drawing, no
 * maths). Measured: the window's first measured day, each ISO-week Sunday, the last measured day.
 * Prognose: the last measured day (shared, so the line is continuous), each prognose Sunday, the
 * last prognose day. `band`: the prognose days that carry a band, by the same rule (its first and
 * last day plus the Sundays between), so the area starts where Python's band starts.
 */
export function curveAnchors<P extends { readonly date: IsoDate; readonly kind: "actual" | "projected" }>(
  points: readonly P[],
  hasBand: (p: P) => boolean = () => false,
): { readonly measured: readonly P[]; readonly prognose: readonly P[]; readonly band: readonly P[] } {
  const measured = weeklyAnchors(points.filter((p) => p.kind === "actual"));
  const projected = points.filter((p) => p.kind === "projected");
  const last = measured.at(-1);
  const prognose = projected.length === 0 ? [] : [...(last === undefined ? [] : [last]), ...weeklyAnchors(projected, false)];
  return { measured, prognose, band: weeklyAnchors(projected.filter(hasBand)) };
}

/** The first point (when `first`), every ISO-week Sunday, and the last point; ascending, no repeats. */
function weeklyAnchors<P extends { readonly date: IsoDate }>(points: readonly P[], first = true): P[] {
  return points.filter(
    (p, i) => (first && i === 0) || i === points.length - 1 || addDays(isoWeekStart(p.date), 6) === p.date,
  );
}
