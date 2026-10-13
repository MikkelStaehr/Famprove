import assert from "node:assert/strict";
import { test } from "node:test";

import type { SetState } from "../src/lib/set-taps.ts";
import { headBarcode, type WeekColumn, weekColumnsGeometry, weekSentence } from "../src/lib/training-view.ts";

const WEEK: readonly WeekColumn[] = [
  { session: 1, sets: 20, status: "done" },
  { session: 2, sets: 24, status: "current" },
  { session: 3, sets: 18, status: "future" },
];

function states(done: number, skipped: number, total: number): SetState[] {
  return Array.from({ length: total }, (_, i) => (i < done ? "done" : i < done + skipped ? "skipped" : "open"));
}

test("head barcode: one tick per set, 8px pitch, +4px between exercises, heights by state", () => {
  const code = headBarcode([
    { state: "done", name: "Squat" },
    { state: "skipped", name: "Squat " },
    { state: "open", name: "Bench" },
  ]);
  assert.equal(code.ticks.length, 3);
  assert.deepEqual(code.ticks.map((t) => t.x), [0, 8, 20]); // name change (trimmed) adds 4px
  assert.deepEqual(code.ticks.map((t) => [t.y, t.height]), [[0, 20], [12, 8], [16, 4]]); // bottom-aligned
  assert.equal(code.width, 22);
  assert.equal(code.height, 20);
});

test("head barcode: many sets shrink the pitch to fit the width", () => {
  const sets = Array.from({ length: 101 }, () => ({ state: "open" as const, name: "Row" }));
  const code = headBarcode(sets, 202);
  assert.equal(code.ticks.length, 101);
  assert.equal(code.ticks[1].x, 2);
  assert.equal(code.width, 202);
  assert.equal(headBarcode([]).width, 0);
});

test("week columns: N columns, a tick per set, pitch min(3, 48 / max sets), bottom-aligned", () => {
  const g = weekColumnsGeometry(WEEK, states(7, 1, 24));
  assert.equal(g.columns.length, 3);
  assert.deepEqual(g.columns.map((c) => c.ticks.length), [20, 24, 18]);
  assert.equal(g.pitch, 2);
  assert.equal(g.baseline, 48);
  assert.deepEqual(g.columns.map((c) => c.x), [0, 16, 32]);
  assert.equal(g.width, 40);
  assert.deepEqual(g.columns.map((c) => c.top), [8, 0, 12]);
  assert.equal(g.columns[0].ticks[0].y, 47); // first set at the bottom
  assert.equal(g.columns[0].ticks[1].y, 45);
  assert.equal(g.height, 52); // baseline + 2 gap + 2 today tick
});

test("week columns: tones and the red today tick only under the current session", () => {
  const g = weekColumnsGeometry(WEEK, states(7, 1, 24));
  assert.ok(g.columns[0].ticks.every((t) => t.tone === "text"));
  const current = g.columns[1].ticks.map((t) => t.tone);
  assert.equal(current.filter((t) => t === "text").length, 8); // done + skipped
  assert.equal(current.filter((t) => t === "muted").length, 16);
  assert.ok(g.columns[2].ticks.every((t) => t.tone === "border"));
  assert.deepEqual(g.columns.map((c) => [c.today, c.outline]), [[false, false], [true, false], [false, true]]);
  // Few sets: the 3px cap.
  assert.equal(weekColumnsGeometry([{ session: 1, sets: 4, status: "done" }], null).pitch, 3);
});

test("week columns: a finished week draws every column done, no today tick", () => {
  const g = weekColumnsGeometry(
    WEEK.map((c) => ({ ...c, status: "done" as const })),
    null,
  );
  assert.ok(g.columns.every((c) => !c.today && !c.outline && c.ticks.every((t) => t.tone === "text")));
  assert.equal(weekColumnsGeometry([], null).width, 0);
});

test("week sentence: done, in progress with counts, not begun", () => {
  assert.equal(
    weekSentence(WEEK, states(7, 1, 24)),
    "Ugen: session 1 udført, session 2 i gang med 7 af 24 sæt, session 3 ikke begyndt.",
  );
  assert.equal(
    weekSentence(WEEK, states(0, 0, 24)),
    "Ugen: session 1 udført, session 2 ikke begyndt, session 3 ikke begyndt.",
  );
  assert.equal(weekSentence(WEEK, states(0, 2, 24)).includes("session 2 i gang med 0 af 24 sæt"), true);
});
