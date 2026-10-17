/**
 * The app's motion constants and helpers (user, 2026-10-15; reference design/reference/famprove-motion.html,
 * DESIGN.md Part B "Motion"). Pure: no DOM, no React; unit-tested with `node --test`. Every duration
 * and easing lives here once (globals.css carries the CSS side as --ease-ember / --dur-*; the
 * motion test holds the two equal). Under prefers-reduced-motion nothing animates (callers check).
 */

/** The one reduced-motion query every animation checks before it starts (DESIGN.md Motion: off). */
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** The reference's one CSS curve, cubic-bezier(.2,.8,.2,1): unfolds, rolls, draws, pills. */
export const EASE_EMBER = "cubic-bezier(.2,.8,.2,1)";

/** Durations in ms (DESIGN.md Part B "Motion" timing table). */
export const DUR = {
  stack: 440, // the card stack: swipe release and tab tap
  draw: 900, // the fitness curve drawing itself
  ringAt: 750, // today's ring appears
  prognoseAt: 850, // the prognose fades in
  morph: 420, // 4U / 12U / Sæson
  roll: 750, // rolling digits
  rollStagger: 45, // per digit
  unfold: 380, // Træning's exercises
  sheetOpen: 380, // the bottom sheet slides up (fokus-sheet.md §17); the scrim fades with it
  sheetClose: 240, // it slides down, or settles back after a swipe that does not close
  check: 400, // the check drawing itself, the dot's pop
  bars: 600, // Analyse's bars growing
  barStagger: 40,
  iconLift: 600, // the dumbbell
  iconDraw: 650, // the curve
  iconGrow: 500, // the bars, 70 ms apart
  iconStagger: 70,
} as const;

/** easeOutQuart: the stack. */
export function easeOutQuart(t: number): number {
  return 1 - (1 - t) ** 4;
}

/** easeOutCubic: the range morph. */
export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export type Point = readonly [x: number, y: number];

/**
 * `n` points evenly spaced in x along the polyline `pts` (linear between points), so two curves of
 * different lengths can morph point by point. Fewer than 2 points: the input repeated.
 */
export function resample(pts: readonly Point[], n: number): Point[] {
  if (pts.length === 0 || n <= 0) return [];
  if (pts.length === 1 || n === 1) return Array.from({ length: n }, () => pts[0]);
  const x0 = pts[0][0];
  const x1 = pts[pts.length - 1][0];
  const out: Point[] = [];
  let j = 0;
  for (let k = 0; k < n; k += 1) {
    const x = x0 + ((x1 - x0) * k) / (n - 1);
    while (j < pts.length - 2 && pts[j + 1][0] < x) j += 1;
    const [ax, ay] = pts[j];
    const [bx, by] = pts[j + 1];
    const t = bx === ax ? 0 : Math.min(1, Math.max(0, (x - ax) / (bx - ax)));
    out.push([x, ay + (by - ay) * t]);
  }
  return out;
}

/** Point-by-point interpolation of two equally long lists at `t` in [0, 1]. */
export function lerpPoints(a: readonly Point[], b: readonly Point[], t: number): Point[] {
  return a.map(([ax, ay], i) => [ax + (b[i][0] - ax) * t, ay + (b[i][1] - ay) * t] as const);
}
