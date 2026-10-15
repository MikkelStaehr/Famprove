import assert from "node:assert/strict";
import { test } from "node:test";

import { DUR } from "../src/lib/motion.ts";
import { rollPlan, sameShape, shapeKey } from "../src/lib/roll.ts";

test("same shape: changed digits roll, delay = 45 ms × index among digits", () => {
  const plan = rollPlan("21,0", "23,4");
  assert.equal(plan.rolls, true);
  assert.deepEqual(plan.cells, [
    { kind: "digit", from: 2, to: 2, rolls: false, delayMs: 0 },
    { kind: "digit", from: 1, to: 3, rolls: true, delayMs: DUR.rollStagger },
    { kind: "char", char: "," },
    { kind: "digit", from: 0, to: 4, rolls: true, delayMs: 2 * DUR.rollStagger },
  ]);
});

test("non-digits do not count toward the stagger and swap as plain characters", () => {
  const plan = rollPlan("−15", "+12");
  assert.equal(plan.rolls, true);
  assert.deepEqual(plan.cells[0], { kind: "char", char: "+" });
  assert.deepEqual(plan.cells[1], { kind: "digit", from: 1, to: 1, rolls: false, delayMs: 0 });
  assert.deepEqual(plan.cells[2], { kind: "digit", from: 5, to: 2, rolls: true, delayMs: 45 });
});

test("structure change shows the new value with no roll (9 → 10, 9,8 → 10,2, −3 → 4, – → 108)", () => {
  for (const [a, b] of [["9", "10"], ["9,8", "10,2"], ["−3", "4"], ["–", "108"]]) {
    assert.equal(sameShape(a, b), false, `${a} → ${b}`);
    const plan = rollPlan(a, b);
    assert.equal(plan.rolls, false, `${a} → ${b}`);
    for (const c of plan.cells) if (c.kind === "digit") assert.deepEqual([c.from, c.rolls, c.delayMs], [c.to, false, 0]);
  }
});

test("an unchanged value rolls nothing; the cells spell the new text", () => {
  assert.equal(rollPlan("108", "108").rolls, false);
  const text = rollPlan("1", "−4,2")
    .cells.map((c) => (c.kind === "digit" ? String(c.to) : c.char))
    .join("");
  assert.equal(text, "−4,2");
});

test("shapeKey changes exactly when the shape does", () => {
  assert.equal(shapeKey("21,0"), shapeKey("98,7"));
  assert.notEqual(shapeKey("9,8"), shapeKey("10,2"));
  assert.equal(shapeKey("−3"), shapeKey("+3")); // a sign swap keeps the columns
  assert.notEqual(shapeKey("−3"), shapeKey("4"));
});
