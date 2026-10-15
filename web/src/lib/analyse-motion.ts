/**
 * Analyse's entry motion, the pure part (slice motion-analyse; reference famprove-motion.html
 * barsIn() / sparksIn(), DESIGN.md Part B "Motion"): when each bar and line starts. No DOM;
 * unit-tested with `node --test`. The DOM side is components/motion/useAnalyseMotion.ts.
 */
import { DUR } from "./motion.ts";

/** sparksIn(): each line draws over 800 ms, the i-th (page order) starting at 200 + 120·i ms. */
export const SPARK = { at: 200, stagger: 120, draw: 800, marksFade: 250 } as const;

/** A strip's whole ripple (first bar's start to last bar's start) is at most the reference's 480 ms. */
export const BAR_RIPPLE = 480;

/**
 * barsIn(): the i-th of a strip's n bars (x order) starts growing at base + stagger·i ms, over 600 ms.
 * stagger = 40 ms up to 13 bars, else 480/(n − 1), so a long strip (≈ 94 weeks) ripples in 480 ms too.
 */
export function barDelay(i: number, n: number, base = 0): number {
  const stagger = n > 1 ? Math.min(DUR.barStagger, BAR_RIPPLE / (n - 1)) : DUR.barStagger;
  return base + i * stagger;
}

/** sparksIn(): the i-th line on the page (document order) starts drawing at base + 200 + 120·i ms. */
export function lineDelay(i: number, base = 0): number {
  return base + SPARK.at + i * SPARK.stagger;
}

/**
 * A chart's dots and markers fade in once its last line has drawn: after the line with page index
 * `lastLine`; a chart without a line fades at its turn `ownTurn` (as if it were a line).
 */
export function marksDelay(lastLine: number | null, ownTurn: number, base = 0): number {
  return lineDelay(lastLine ?? ownTurn, base) + SPARK.draw;
}

export type Pt = readonly [x: number, y: number];

/** A polyline's length after scaling x by sx and y by sy (a viewBox stretched with preserveAspectRatio none). */
export function polylineLength(points: readonly Pt[], sx = 1, sy = 1): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = (points[i][0] - points[i - 1][0]) * sx;
    const dy = (points[i][1] - points[i - 1][1]) * sy;
    total += Math.hypot(dx, dy);
  }
  return total;
}

/**
 * The dash length that hides and then reveals a line: at least its length in every space a
 * browser may dash it in (user units, or screen pixels under vector-effect non-scaling-stroke),
 * so it starts fully hidden and ends fully drawn. Never below 1.
 */
export function dashLength(...lengths: readonly number[]): number {
  const finite = lengths.filter((l) => Number.isFinite(l) && l > 0);
  return Math.max(1, Math.ceil(Math.max(0, ...finite)));
}
