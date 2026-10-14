/**
 * A smooth SVG path through every point that never overshoots between two neighbours: monotone cubic
 * (Hermite) interpolation with d3's curveMonotoneX tangents (Steffen 1990, the Fritsch–Carlson
 * family). The curve passes exactly through each point; between two points it stays inside their
 * y range, so a flat run stays flat and a rising run never dips. Drawing only: no value is computed
 * here that the UI shows.
 */
export type PathPoint = { readonly x: number; readonly y: number };

/** One cubic Bézier piece from `p0` to `p1` with control points `c1`, `c2`. */
export type Segment = {
  readonly p0: PathPoint;
  readonly c1: PathPoint;
  readonly c2: PathPoint;
  readonly p1: PathPoint;
};

const sign = (v: number): number => (v < 0 ? -1 : 1);

/** The tangent at the middle point (d3 slope3): 0 at a local extremum, else bounded by both slopes. */
function innerTangent(a: PathPoint, b: PathPoint, c: PathPoint): number {
  const h0 = b.x - a.x;
  const h1 = c.x - b.x;
  if (h0 === 0 || h1 === 0) return 0;
  const s0 = (b.y - a.y) / h0;
  const s1 = (c.y - b.y) / h1;
  const p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
}

/** The tangent at an end point from its segment's slope and the inner tangent (d3 slope2). */
function endTangent(a: PathPoint, b: PathPoint, t: number): number {
  const h = b.x - a.x;
  return h === 0 ? t : ((3 * (b.y - a.y)) / h - t) / 2;
}

/**
 * The Bézier pieces between consecutive points (x ascending or descending; one piece fewer than
 * points). Two points give a straight piece; 0 or 1 points give none.
 */
export function monotoneSegments(points: readonly PathPoint[]): Segment[] {
  const n = points.length;
  if (n < 2) return [];
  const t: number[] = new Array<number>(n).fill(0);
  if (n === 2) {
    const [a, b] = points as readonly [PathPoint, PathPoint];
    const s = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x);
    t[0] = s;
    t[1] = s;
  } else {
    for (let i = 1; i < n - 1; i++) t[i] = innerTangent(points[i - 1], points[i], points[i + 1]);
    t[0] = endTangent(points[0], points[1], t[1]);
    t[n - 1] = endTangent(points[n - 2], points[n - 1], t[n - 2]);
  }
  const out: Segment[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const dx = (p1.x - p0.x) / 3;
    out.push({
      p0,
      c1: { x: p0.x + dx, y: p0.y + dx * t[i] },
      c2: { x: p1.x - dx, y: p1.y - dx * t[i + 1] },
      p1,
    });
  }
  return out;
}

const f = (v: number): string => v.toFixed(1);

/**
 * Path data for the pieces: `M` to the first piece's start (or `L` with `join: true`, to continue an
 * open path, e.g. an area's lower edge) and one `C` per piece. No pieces: an empty string.
 */
export function segmentsPath(segments: readonly Segment[], join = false): string {
  const first = segments[0];
  if (first === undefined) return "";
  const start = `${join ? "L" : "M"}${f(first.p0.x)} ${f(first.p0.y)}`;
  return start + segments.map((s) => `C${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.p1.x)} ${f(s.p1.y)}`).join("");
}

/** The monotone path through `points`; one point is a lone `M`, none an empty string. */
export function monotonePath(points: readonly PathPoint[], join = false): string {
  const only = points.length === 1 ? points[0] : undefined;
  if (only !== undefined) return `${join ? "L" : "M"}${f(only.x)} ${f(only.y)}`;
  return segmentsPath(monotoneSegments(points), join);
}
