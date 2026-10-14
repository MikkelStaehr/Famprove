import assert from "node:assert/strict";
import { test } from "node:test";

import { AMARKS, dashGradient, hatchGradient, isDeloadWeek } from "../src/lib/analyse-marks.ts";

test("deload weeks: a slot whose centre lies in a block's deload part", () => {
  const blocks = [
    { x0: 0, x1: 28, deloadX0: 21 },
    { x0: 35, x1: 63, deloadX0: null },
  ];
  assert.equal(isDeloadWeek({ x0: 21, x1: 28 }, blocks), true);
  assert.equal(isDeloadWeek({ x0: 14, x1: 21 }, blocks), false);
  // A gap week between blocks and a block without a deload are not deload.
  assert.equal(isDeloadWeek({ x0: 28, x1: 35 }, blocks), false);
  assert.equal(isDeloadWeek({ x0: 56, x1: 63 }, blocks), false);
  assert.equal(isDeloadWeek({ x0: 0, x1: 7 }, []), false);
});

test("gradients use the given tokens and pitch, never hex", () => {
  assert.equal(dashGradient("to right", "var(--axis)", 2, 3), "repeating-linear-gradient(to right, var(--axis) 0 2px, transparent 2px 5px)");
  assert.match(hatchGradient(), /^repeating-linear-gradient\(135deg, var\(--shade-2\) 0 1px, var\(--card\) 1px 4px\)$/);
  assert.doesNotMatch(JSON.stringify(AMARKS), /#[0-9a-f]{3,6}/i);
});

test("today is the only --today mark", () => {
  const uses = JSON.stringify(AMARKS).match(/--today/g) ?? [];
  assert.equal(uses.length, 1);
});
