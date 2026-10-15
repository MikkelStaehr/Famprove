import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { DUR, EASE_EMBER, easeOutCubic, easeOutQuart, lerpPoints, resample } from "../src/lib/motion.ts";

test("easings end where they start and finish", () => {
  for (const f of [easeOutQuart, easeOutCubic]) {
    assert.equal(f(0), 0);
    assert.equal(f(1), 1);
    assert.ok(f(0.5) > 0.5); // ease-out: ahead of linear
  }
});

test("resample: n points evenly in x, linear between the inputs, ends kept", () => {
  const out = resample([[0, 0], [10, 10], [20, 0]], 5);
  assert.deepEqual(out, [[0, 0], [5, 5], [10, 10], [15, 5], [20, 0]]);
  assert.deepEqual(resample([[3, 7]], 3), [[3, 7], [3, 7], [3, 7]]);
  assert.deepEqual(resample([], 4), []);
});

test("lerpPoints morphs point by point", () => {
  assert.deepEqual(lerpPoints([[0, 0], [10, 10]], [[0, 10], [10, 0]], 0.25), [[0, 2.5], [10, 7.5]]);
});

test("DESIGN.md Part B Motion and the code agree (the timing table is the contract)", () => {
  const design = readFileSync(new URL("../../DESIGN.md", import.meta.url), "utf-8");
  for (const ms of [DUR.stack, DUR.draw, DUR.ringAt, DUR.prognoseAt, DUR.morph, DUR.roll, DUR.rollStagger, DUR.unfold, DUR.bars, DUR.barStagger]) {
    assert.ok(design.includes(`${ms} ms`) || design.includes(`${ms}ms`), `DESIGN.md names ${ms} ms`);
  }
  assert.ok(design.replace(/\s/g, "").includes(EASE_EMBER.replace(/\s/g, "")), "DESIGN.md names the ember curve");
});
