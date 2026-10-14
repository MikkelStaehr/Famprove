import assert from "node:assert/strict";
import { test } from "node:test";

import { monotonePath, monotoneSegments, type PathPoint, type Segment, segmentsPath } from "../src/lib/monotone-path.ts";

const pts = (ys: readonly number[], step = 10): PathPoint[] => ys.map((y, i) => ({ x: i * step, y }));

/** The piece's point at t (cubic Bézier). */
function at(s: Segment, t: number): PathPoint {
  const u = 1 - t;
  const b = (a: number, c1: number, c2: number, d: number) => u * u * u * a + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * d;
  return { x: b(s.p0.x, s.c1.x, s.c2.x, s.p1.x), y: b(s.p0.y, s.c1.y, s.c2.y, s.p1.y) };
}

const samples = (s: Segment): PathPoint[] => Array.from({ length: 41 }, (_, i) => at(s, i / 40));
const EPS = 1e-9;

test("passes exactly through every point, in order", () => {
  const input = pts([12, 14.5, 13, 13, 20, 8, 9.25]);
  const segs = monotoneSegments(input);
  assert.equal(segs.length, input.length - 1);
  segs.forEach((s, i) => {
    assert.deepEqual(s.p0, input[i]);
    assert.deepEqual(s.p1, input[i + 1]);
  });
});

test("never overshoots: each piece stays inside its two points' y range", () => {
  const input = pts([12, 14.5, 13, 13, 20, 8, 9.25, 30, 29, 29.5]);
  for (const s of monotoneSegments(input)) {
    const lo = Math.min(s.p0.y, s.p1.y) - EPS;
    const hi = Math.max(s.p0.y, s.p1.y) + EPS;
    for (const p of samples(s)) assert.ok(p.y >= lo && p.y <= hi, `y ${p.y} outside ${lo}..${hi}`);
  }
});

test("monotone data stays monotone (rising and falling, uneven steps)", () => {
  const rising = [1, 1.2, 4, 4.1, 9, 15, 15.5, 30];
  for (const ys of [rising, rising.toReversed()]) {
    const ps = monotoneSegments(pts(ys)).flatMap(samples);
    const dir = Math.sign(ys.at(-1)! - ys[0]);
    for (let i = 1; i < ps.length; i++) {
      assert.ok(ps[i].x >= ps[i - 1].x - EPS, "x never goes back");
      assert.ok(dir * (ps[i].y - ps[i - 1].y) >= -EPS, `not monotone at ${ps[i].x}`);
    }
  }
});

test("flat stays flat, also a flat run between a rise and a fall", () => {
  for (const s of monotoneSegments(pts([5, 5, 5, 5]))) {
    assert.deepEqual([s.c1.y, s.c2.y], [5, 5]);
  }
  const segs = monotoneSegments(pts([0, 7, 7, 7, 2]));
  for (const s of segs.slice(1, 3)) {
    for (const p of samples(s)) assert.ok(Math.abs(p.y - 7) < EPS, `flat run bent to ${p.y}`);
  }
});

test("a lower edge drawn backwards is the same curve as the upper edge drawn forwards", () => {
  const input = pts([3, 8, 6, 6.5, 12]);
  const fwd = monotoneSegments(input);
  const back = monotoneSegments(input.toReversed()).toReversed();
  fwd.forEach((s, i) => {
    const r = back[i];
    assert.ok(Math.abs(s.c1.y - r.c2.y) < EPS && Math.abs(s.c2.y - r.c1.y) < EPS);
  });
});

test("0, 1 and 2 points", () => {
  assert.equal(monotonePath([]), "");
  assert.equal(monotonePath([], true), "");
  assert.equal(monotonePath([{ x: 3, y: 4 }]), "M3.0 4.0");
  assert.equal(monotonePath([{ x: 3, y: 4 }], true), "L3.0 4.0");
  const two = monotoneSegments([{ x: 0, y: 0 }, { x: 30, y: 15 }]);
  assert.equal(two.length, 1);
  // A straight piece: both control points on the line.
  assert.deepEqual([two[0].c1, two[0].c2], [{ x: 10, y: 5 }, { x: 20, y: 10 }]);
  assert.equal(monotonePath([{ x: 0, y: 0 }, { x: 30, y: 15 }]), "M0.0 0.0C10.0 5.0 20.0 10.0 30.0 15.0");
});

test("path data: M then one C per piece; join continues with L", () => {
  const segs = monotoneSegments(pts([1, 2, 3]));
  const d = segmentsPath(segs);
  assert.match(d, /^M0\.0 1\.0C[^MLC]+C[^MLC]+$/);
  assert.ok(d.endsWith(" 20.0 3.0"));
  assert.ok(segmentsPath(segs, true).startsWith("L0.0 1.0C"));
  assert.equal(segmentsPath([]), "");
});
