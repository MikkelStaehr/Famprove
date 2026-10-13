import assert from "node:assert/strict";
import { test } from "node:test";

import { BARCODE, dayBarcode, tickCount } from "../src/lib/day-barcode.ts";

const count = (g: ReturnType<typeof dayBarcode>, part: "cycling" | "strength") =>
  g.ticks.filter((t) => t.part === part).length;

test("one tick per 10 TSS per part: n = round(tss / 10)", () => {
  // A fixture week: cycling / strength TSS per day as stored.
  const week: readonly (readonly [number | null, number | null])[] = [
    [86, 0],
    [0, 61.4],
    [44.9, 55],
    [5, 4.9],
    [null, 72],
  ];
  for (const [cycling, strength] of week) {
    const g = dayBarcode(cycling, strength, 500);
    assert.equal(count(g, "cycling"), cycling === null ? 0 : Math.round(cycling / 10));
    assert.equal(count(g, "strength"), strength === null ? 0 : Math.round(strength / 10));
    assert.equal(g.endBarX, null);
  }
});

test("a rest day (0 / 0) and missing TSS draw nothing", () => {
  assert.deepEqual(dayBarcode(0, 0, 100), { ticks: [], endBarX: null });
  assert.deepEqual(dayBarcode(null, null, 100), { ticks: [], endBarX: null });
  assert.equal(tickCount(Number.NaN), 0);
  assert.equal(tickCount(-20), 0);
});

test("cycling 1×16 at pitch 3, strength 1×8 after a 4px gap", () => {
  const g = dayBarcode(30, 20, 200);
  assert.deepEqual(
    g.ticks.map((t) => [t.x, t.h]),
    [
      [0, 16],
      [3, 16],
      [6, 16],
      [11, 8],
      [14, 8],
    ],
  );
  // Strength only starts at 0.
  assert.equal(dayBarcode(0, 20, 200).ticks[0]?.x, 0);
});

test("overflow: ticks stop before a 1×16 end bar with a 2px gap", () => {
  const width = 48;
  const g = dayBarcode(300, 100, width);
  assert.equal(g.endBarX, width - BARCODE.endBar);
  const lastRight = Math.max(...g.ticks.map((t) => t.x + BARCODE.tick));
  assert.ok(lastRight <= width - BARCODE.endBar - BARCODE.endGap);
  assert.ok(g.ticks.length < 40);
  // Exactly fitting draws no end bar.
  const fit = dayBarcode(160, 0, 46); // 16 ticks: last at 45, right edge 46
  assert.equal(fit.endBarX, null);
  assert.equal(fit.ticks.length, 16);
});
