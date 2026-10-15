import assert from "node:assert/strict";
import { test } from "node:test";

import { buzz, curveShape, curveYAt, MORPH_MEASURED, MORPH_PROGNOSE, morphFrame, sampleSegments } from "../src/lib/curve-motion.ts";
import { monotoneSegments } from "../src/lib/monotone-path.ts";

const measured = monotoneSegments([
  { x: 0, y: 100 },
  { x: 50, y: 60 },
  { x: 100, y: 80 },
]);
const prognose = monotoneSegments([
  { x: 100, y: 80 },
  { x: 150, y: 70 },
]);

test("curveYAt passes through the anchors and holds the ends outside", () => {
  assert.equal(curveYAt(measured, 0), 100);
  assert.ok(Math.abs((curveYAt(measured, 50) ?? NaN) - 60) < 1e-9);
  assert.equal(curveYAt(measured, 100), 80);
  assert.equal(curveYAt(measured, -10), 100);
  assert.equal(curveYAt(measured, 200), 80);
  assert.equal(curveYAt([], 10), null);
  const mid = curveYAt(measured, 25) ?? NaN;
  assert.ok(mid <= 100 && mid >= 60); // monotone: inside its neighbours' range
});

test("sampleSegments starts and ends on the anchors, x ascending", () => {
  const pts = sampleSegments(measured, 4);
  assert.equal(pts.length, 1 + 2 * 4);
  assert.deepEqual(pts[0], [0, 100]);
  assert.deepEqual(pts.at(-1), [100, 80]);
  for (let i = 1; i < pts.length; i += 1) assert.ok(pts[i][0] > pts[i - 1][0]);
  assert.deepEqual(sampleSegments([]), []);
});

test("curveShape resamples to the fixed counts", () => {
  const s = curveShape(measured, prognose);
  assert.equal(s.measured.length, MORPH_MEASURED);
  assert.equal(s.prognose.length, MORPH_PROGNOSE);
  assert.deepEqual(curveShape([], []), { measured: [], prognose: [] });
});

test("morphFrame: t = 0 is the old shape, t = 1 the new, the ring on the measured end", () => {
  const a = curveShape(measured, prognose);
  const shifted = monotoneSegments([
    { x: 0, y: 40 },
    { x: 120, y: 20 },
  ]);
  const b = curveShape(shifted, []);
  const f0 = morphFrame(a, b, 0);
  assert.ok(f0.measured.startsWith("M0.0 100.0"));
  assert.deepEqual(f0.ring, [100, 80]);
  assert.equal(f0.prognose, ""); // no prognose on one side: nothing until the end
  const f1 = morphFrame(a, b, 1);
  assert.ok(f1.measured.startsWith("M0.0 40.0"));
  assert.deepEqual(f1.ring, [120, 20]);
  const half = morphFrame(a, b, 0.5);
  assert.ok(half.measured.startsWith("M0.0 70.0"));
});

test("buzz ticks 4 ms where vibrate exists and never throws", () => {
  const calls: number[] = [];
  buzz({ vibrate: (p) => (calls.push(p), true) });
  assert.deepEqual(calls, [4]);
  buzz({});
  buzz(undefined);
  buzz({
    vibrate: () => {
      throw new Error("blocked");
    },
  });
});
