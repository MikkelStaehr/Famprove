/**
 * The fitness curve's motion helpers (slice `motion-load`; reference design/reference/famprove-motion.html
 * morphTo(), scrubAt(), buzz()). Pure: px geometry only, no DOM, no React; unit-tested with `node --test`.
 * Nothing here computes a value the UI shows: the morph frames are drawing only, and at rest the curve
 * is the static render.
 */
import { lerpPoints, type Point, resample } from "./motion.ts";
import { monotonePath, type Segment } from "./monotone-path.ts";

/** The morph's fixed point counts, as the reference's NH / NF. */
export const MORPH_MEASURED = 90;
export const MORPH_PROGNOSE = 30;

/** A curve as morphable px points: measured and prognose, each resampled to a fixed count (or empty). */
export type CurveShape = { readonly measured: readonly Point[]; readonly prognose: readonly Point[] };

/** The y of the cubic Bézier at parameter `t`. */
function bezierY(s: Segment, t: number): number {
  const u = 1 - t;
  return u * u * u * s.p0.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.p1.y;
}

/**
 * The drawn curve's y at `x`. A monotone piece's control points sit at its thirds in x, so x is linear
 * in t and t = (x − x0) / (x1 − x0). Outside the pieces: the nearest end's y; no pieces: null.
 */
export function curveYAt(segments: readonly Segment[], x: number): number | null {
  const first = segments[0];
  const last = segments.at(-1);
  if (first === undefined || last === undefined) return null;
  if (x <= first.p0.x) return first.p0.y;
  if (x >= last.p1.x) return last.p1.y;
  const s = segments.find((g) => x <= g.p1.x) ?? last;
  const dx = s.p1.x - s.p0.x;
  return bezierY(s, dx === 0 ? 0 : (x - s.p0.x) / dx);
}

/** The pieces as a polyline, `steps` samples per piece (end points included once). */
export function sampleSegments(segments: readonly Segment[], steps = 8): Point[] {
  const first = segments[0];
  if (first === undefined) return [];
  const out: Point[] = [[first.p0.x, first.p0.y]];
  for (const s of segments) {
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      out.push([s.p0.x + (s.p1.x - s.p0.x) * t, bezierY(s, t)]);
    }
  }
  return out;
}

/** The morphable shape of a curve's measured and prognose pieces. */
export function curveShape(measured: readonly Segment[], prognose: readonly Segment[]): CurveShape {
  return {
    measured: resample(sampleSegments(measured), MORPH_MEASURED),
    prognose: resample(sampleSegments(prognose), MORPH_PROGNOSE),
  };
}

/** One list at `t`: lerped when both sides exist; otherwise nothing until the end, then the target. */
function frameList(a: readonly Point[], b: readonly Point[], t: number): readonly Point[] {
  if (a.length === b.length) return lerpPoints(a, b, t);
  return t < 1 ? [] : b;
}

export type MorphFrame = {
  readonly measured: string; // path d
  readonly prognose: string; // path d
  readonly ring: Point | null; // the measured line's end
};

/** The morph frame at eased `t` in [0, 1]: monotone paths through the lerped points, as the reference. */
export function morphFrame(from: CurveShape, to: CurveShape, t: number): MorphFrame {
  const m = frameList(from.measured, to.measured, t);
  const p = frameList(from.prognose, to.prognose, t);
  const xy = (pts: readonly Point[]) => pts.map(([x, y]) => ({ x, y }));
  return { measured: monotonePath(xy(m)), prognose: monotonePath(xy(p)), ring: m.at(-1) ?? null };
}

/** A navigator, as far as the haptic tick needs it (iOS Safari has no vibrate). */
export type Vibrating = { readonly vibrate?: (pattern: number) => boolean };

/** The reference's buzz(): a 4 ms tick where vibrate exists; never throws. Not motion: kept under reduced motion. */
export function buzz(nav: Vibrating | undefined): void {
  try {
    nav?.vibrate?.(4);
  } catch {
    // A browser that refuses (no user activation, a policy) is not an error.
  }
}
