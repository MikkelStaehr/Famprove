import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyTap,
  jumpRunRows,
  type LoggedSet,
  type RunSet,
  type SessionShape,
  setKey,
  shapeOrder,
  withSessionOrder,
  sessionOrderWithWarmups,
} from "../src/lib/set-taps.ts";

// Runs: A row 10 (2 sets), B row 11 (2 sets), C row 12 (2 sets), D row 13 (2 sets).
const SETS: RunSet[] = [10, 11, 12, 13].flatMap((row, i) =>
  [1, 2].map((set) => ({ ref: { row, set }, name: ["Squat", "Bench", "Row", "Curl"][i] })),
);
const T = (m: number) => new Date(Date.parse("2026-10-12T08:00:00.000Z") + m * 60_000).toISOString();
const keys = (refs: readonly { row: number; set: number }[]) => refs.map(setKey).join(" ");

function play(shape: SessionShape, taps: readonly [string, number, number][]): Map<string, LoggedSet> {
  let log = new Map<string, LoggedSet>();
  taps.forEach(([kind, row, set], m) => {
    log = applyTap(shapeOrder(shape), log, kind as "done", { row, set }, T(m));
  });
  return log;
}

test("jump from B after B1 to C: C, then B2, then the rest; C1 starts at B1's end, B2's start is cleared", () => {
  const shape: SessionShape = { sets: SETS, pairs: [], runRows: null };
  const log = play(shape, [["begin", 10, 0], ["done", 10, 0], ["done", 10, 1], ["done", 10, 2], ["done", 11, 0], ["done", 11, 1]]);
  const runRows = jumpRunRows(shape, log, 12);
  assert.deepEqual(runRows, [10, 12, 11, 13]);
  const after = applyTap(shapeOrder(shape), log, "jump", { row: 12, set: 1 }, T(9), null, new Map(), shape);
  const order = shapeOrder({ ...shape, runRows });
  assert.equal(keys(order), "10#0 10#1 10#2 12#0 12#1 12#2 11#0 11#1 11#2 13#0 13#1 13#2");
  assert.equal(after.get("12#0")?.startedAt, log.get("11#1")?.endedAt); // C's warm-up is open: it gets the start
  assert.equal(after.get("11#2"), undefined); // B2's start cleared, its empty row gone
  // A retry (the same tap on the state after it) changes nothing but writes the same order.
  const again = applyTap(order, after, "jump", { row: 12, set: 1 }, T(10), null, new Map(), { ...shape, runRows });
  assert.deepEqual(again, after);
  assert.deepEqual(jumpRunRows({ ...shape, runRows }, after, 12), runRows);
});

test("C1's start equals B1's end when C has no warm-up (a variant run)", () => {
  const sets: RunSet[] = SETS.map((s) => (s.ref.row === 12 ? { ...s, name: "Bench", variantId: 7 } : s.ref.row === 11 ? { ...s, variantId: 6 } : s));
  const shape: SessionShape = { sets, pairs: [], runRows: null };
  const log = play(shape, [["begin", 10, 0], ["done", 10, 0], ["done", 10, 1], ["done", 10, 2], ["done", 11, 0], ["done", 11, 1]]);
  const after = applyTap(shapeOrder(shape), log, "jump", { row: 12, set: 1 }, T(9), null, new Map(), shape);
  assert.equal(after.get("12#1")?.startedAt, log.get("11#1")?.endedAt);
  assert.equal(after.get("11#2")?.startedAt ?? null, null);
});

test("a superset pair moves as one unit; an unknown row and a done run are refused", () => {
  const shape: SessionShape = { sets: SETS, pairs: [{ rowA: 12, rowB: 13 }], runRows: null };
  const log = play(shape, [["begin", 10, 0], ["done", 10, 0], ["done", 10, 1]]);
  assert.deepEqual(jumpRunRows(shape, log, 13), [12, 13, 10, 11]); // A half done comes right after the pair
  assert.equal(jumpRunRows(shape, log, 99), null);
  assert.equal(jumpRunRows(shape, log, 14), null);
  const done = play(shape, [["begin", 10, 0], ["done", 10, 0], ["done", 10, 1], ["done", 10, 2]]);
  assert.equal(jumpRunRows(shape, done, 10), null);
});

test("withSessionOrder: unknown rows are ignored, no rows = the sheet's order, an unnamed run keeps its place", () => {
  const base = sessionOrderWithWarmups(SETS);
  assert.deepEqual(withSessionOrder(base, SETS, [], null), base);
  assert.deepEqual(withSessionOrder(base, SETS, [], [99, 98]), base);
  assert.equal(keys(withSessionOrder(base, SETS, [], [12, 10])).replace(/#\d/g, "").split(" ").filter((r, i, a) => a.indexOf(r) === i).join(" "), "12 13 10 11");
});

test("a reload: the same log and session order give the same order", () => {
  const shape: SessionShape = { sets: SETS, pairs: [], runRows: [10, 12, 11, 13] };
  const a = shapeOrder(shape);
  const b = shapeOrder(structuredClone(shape));
  assert.deepEqual(a, b);
});
