import assert from "node:assert/strict";
import { test } from "node:test";

import { BAR_RIPPLE, barDelay, dashLength, lineDelay, marksDelay, polylineLength, SPARK } from "../src/lib/analyse-motion.ts";
import { DUR } from "../src/lib/motion.ts";

test("barsIn: bars start 40 ms apart in x order, from the entry's base, up to 13 bars", () => {
  assert.equal(DUR.bars, 600);
  assert.deepEqual([0, 1, 2, 10].map((i) => barDelay(i, 12)), [0, 40, 80, 400]);
  assert.equal(barDelay(11, 12), 440);
  assert.equal(barDelay(12, 13), 480);
  assert.equal(barDelay(3, 12, 460), 580);
  assert.equal(barDelay(0, 1), 0);
});

test("barsIn: a long strip's stagger is capped so its whole ripple takes 480 ms", () => {
  assert.equal(BAR_RIPPLE, 480);
  assert.equal(barDelay(93, 94), 480);
  assert.equal(barDelay(1, 94), 480 / 93);
  assert.equal(barDelay(24, 25), 480);
  assert.equal(barDelay(12, 25), 240);
  assert.equal(barDelay(93, 94, 460), 940);
});

test("sparksIn: lines start at 200 + 120·i ms and draw over 800 ms", () => {
  assert.deepEqual([0, 1, 2].map((i) => lineDelay(i)), [200, 320, 440]);
  assert.equal(lineDelay(1, 180), 500);
  assert.equal(SPARK.draw, 800);
});

test("marks fade in after their chart's last line; a chart without a line at its own turn", () => {
  assert.equal(marksDelay(2, 0), 440 + 800);
  assert.equal(marksDelay(null, 3), 560 + 800);
  assert.equal(marksDelay(0, 0, 180), 180 + 200 + 800);
});

test("polylineLength scales x and y separately (a stretched viewBox)", () => {
  assert.equal(polylineLength([[0, 0], [3, 4]]), 5);
  assert.equal(polylineLength([[0, 0], [10, 0], [10, 10]], 0.5, 2), 25);
  assert.equal(polylineLength([[1, 1]]), 0);
  assert.equal(polylineLength([]), 0);
});

test("dashLength covers the longest finite length, never below 1", () => {
  assert.equal(dashLength(120.2, 340.7), 341);
  assert.equal(dashLength(Number.NaN, 0), 1);
  assert.equal(dashLength(), 1);
});
