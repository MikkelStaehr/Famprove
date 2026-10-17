import assert from "node:assert/strict";
import { test } from "node:test";

import { type FokusExercise, fokusView } from "../src/lib/fokus-view.ts";
import { applyTap, isWarmup, jumpRunRows, type LoggedSet, type PairRef, type SessionShape, setKey, shapeOrder } from "../src/lib/set-taps.ts";
import { type PairSlot } from "../src/lib/supersets.ts";
import { clientPairs, runSetsOf, seamViews, supersetOffer } from "../src/lib/superset-view.ts";

// Tester, round fokus-sheet / fokus-superset (HEAD 9969549): the sheet's bar groups over seeded
// random tap sequences, and the set-screen superset button through real taps (applyTap).

function ex(row: number, name: string, n: number): FokusExercise {
  return {
    name, variant: null, variantId: null, repsText: "5", prescribed: null, bodyweight: false, reference: null, row,
    suggestedKg: null, suggestionBasis: null, suggestionCapped: false, adjustmentKg: null, adjustmentReason: null,
    restMinS: 90, restMaxS: 180, ramp: null, todayKg: null, todayBasis: null,
    sets: Array.from({ length: n }, (_, k) => ({ row, set: k + 1 })),
  };
}
const EXERCISES: readonly FokusExercise[] = [ex(20, "Squat", 3), ex(21, "Bench", 3), ex(22, "Pull-ups", 2), ex(23, "Row", 2), ex(24, "Curl", 2)];
const T = (m: number) => new Date(Date.parse("2026-10-19T08:00:00.000Z") + m * 60_000).toISOString();

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("S1: over 300 seeded tap sequences, the bar has one group per run (a pair = one group), warm-ups never in it, every working set once", () => {
  for (const pairs of [[], [{ rowA: 21, rowB: 22 }]] as PairRef[][]) {
    for (let seed = 1; seed <= 150; seed += 1) {
      const r = rng(seed);
      let shape: SessionShape = { sets: runSetsOf(EXERCISES), pairs, runRows: null };
      let log: ReadonlyMap<string, LoggedSet> = new Map();
      const working = shapeOrder(shape).filter((x) => !isWarmup(x));
      for (let k = 0; k < 25; k += 1) {
        const order = shapeOrder(shape);
        const kinds = ["begin", "done", "done", "skip", "undo", "jump"] as const;
        const kind = kinds[Math.floor(r() * kinds.length)];
        const target = order[Math.floor(r() * order.length)];
        const runRows = kind === "jump" ? jumpRunRows(shape, log, target.row) : null;
        log = applyTap(order, log, kind, kind === "jump" ? { row: target.row, set: 1 } : target, T(k), null, new Map(), shape);
        if (runRows !== null) shape = { ...shape, runRows };
        const v = fokusView({ exercises: EXERCISES, pairs, order: shapeOrder(shape), week: 1, session: 1 }, log);
        const segs = v.sheet.groups.flatMap((g) => g.segments.map((s) => s.ref));
        const ctx = `seed ${seed} step ${k} ${kind}`;
        assert.ok(segs.every((s) => !isWarmup(s)), `warm-up in the bar: ${ctx}`);
        assert.deepEqual([...segs.map(setKey)].sort(), working.map(setKey).sort(), `each working set once: ${ctx}`);
        const runsInGroups = v.sheet.groups.flatMap((g) => g.runs);
        assert.equal(new Set(runsInGroups).size, runsInGroups.length, `a run in two groups: ${ctx}`);
        assert.equal(v.sheet.groups.length, pairs.length === 0 ? 5 : 4, `group count: ${ctx}`);
        for (const p of pairs) assert.ok(v.sheet.groups.some((g) => g.pair && g.runs.includes(p.rowA) && g.runs.includes(p.rowB)), `pair split: ${ctx}`);
      }
    }
  }
});

// Bench (21) and Pull-ups (22) as A and B, no pair yet, both offered (fokus-superset.md R1, §4).
const SLOTS: PairSlot[] = [
  { rowA: 20, rowB: 21, paired: false, source: null, locked: false },
  { rowA: 21, rowB: 22, paired: false, source: null, locked: false },
];
const offerAt = (log: ReadonlyMap<string, LoggedSet>, ref: { row: number; set: number }) =>
  supersetOffer(EXERCISES, seamViews(EXERCISES, SLOTS, clientPairs(SLOTS, new Map()), log.values()), ref);

test("U2 (R1): through real taps, the button shows on A's warm-up before any tap on A, and is gone after A0's done", () => {
  const shape: SessionShape = { sets: runSetsOf(EXERCISES), pairs: [], runRows: null };
  const order = shapeOrder(shape);
  let log: ReadonlyMap<string, LoggedSet> = new Map();
  const tap = (kind: "begin" | "done", row: number, set: number, m: number) => {
    log = applyTap(order, log, kind, { row, set }, T(m), null, new Map(), shape);
  };
  // Squat done, then Bench's warm-up is current (the done that ends Squat started it).
  tap("begin", 20, 0, 0);
  for (const [s, m] of [[0, 1], [1, 2], [2, 3], [3, 4]]) tap("done", 20, s, m);
  assert.notEqual(offerAt(log, { row: 21, set: 0 }), null, "on A's warm-up");
  tap("done", 21, 0, 5); // Til sæt 1: A1 now has its start, so the pair is locked (decided 2026-10-17)
  assert.equal(offerAt(log, { row: 21, set: 1 }), null, "gone on A1 after A0's done");
  tap("done", 21, 1, 6);
  assert.equal(offerAt(log, { row: 21, set: 2 }), null, "after A1's done");
});
