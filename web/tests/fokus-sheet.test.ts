import assert from "node:assert/strict";
import { test } from "node:test";

import { type FokusExercise, fokusView } from "../src/lib/fokus-view.ts";
import { applyTap, jumpRunRows, type LoggedSet, type PairRef, type SessionShape, type SetRef, shapeOrder, undoesOf } from "../src/lib/set-taps.ts";
import { clientOrder, runSetsOf } from "../src/lib/superset-view.ts";

// The session sheet (slice fokus-sheet, design/specs/fokus-sheet.md): fokusView's `sheet` field,
// one row per run in tap order and the grouped bar, from the same log and session order.

function ex(row: number, name: string, n: number, o: Partial<FokusExercise> = {}): FokusExercise {
  return {
    name, variant: null, variantId: null, repsText: "5", prescribed: null, bodyweight: false, reference: null, row,
    suggestedKg: null, suggestionBasis: null, suggestionCapped: false, adjustmentKg: null, adjustmentReason: null,
    restMinS: 90, restMaxS: 180, ramp: null, todayKg: null, todayBasis: null, ...o,
    sets: Array.from({ length: n }, (_, k) => ({ row, set: k + 1 })),
  };
}

const EXERCISES: readonly FokusExercise[] = [
  ex(20, "Squat", 2, { todayKg: 100, todayBasis: "sheet" }),
  ex(21, "Bench", 3, { todayKg: 80, todayBasis: "e1rm" }),
  ex(22, "Pull-ups", 2, { bodyweight: true }),
  ex(23, "Lat Pulldown", 2, { variant: "Wide Grip", variantId: 3, todayKg: 50, todayBasis: "last" }),
];
const PAIRS: readonly PairRef[] = [{ rowA: 21, rowB: 22 }];
const T = (m: number) => new Date(Date.parse("2026-10-12T08:00:00.000Z") + m * 60_000).toISOString();

function play(shape: SessionShape, taps: readonly [string, number, number][], log0: ReadonlyMap<string, LoggedSet> = new Map(), m0 = 0) {
  let log = log0;
  let s = shape;
  taps.forEach(([kind, row, set], k) => {
    const runRows = kind === "jump" ? jumpRunRows(s, log, row) : null;
    log = applyTap(shapeOrder(s), log, kind as "done", { row, set }, T(m0 + k), null, new Map(), s);
    if (runRows !== null) s = { ...s, runRows };
  });
  return { log, shape: s };
}

const view = (shape: SessionShape, log: ReadonlyMap<string, LoggedSet>) =>
  fokusView({ exercises: EXERCISES, pairs: shape.pairs, order: shapeOrder(shape), week: 2, session: 1 }, log);

const SHAPE: SessionShape = { sets: runSetsOf(EXERCISES), pairs: PAIRS, runRows: null };
// Squat done, then the pair: warm-ups, A1, B1, A2 done: B2 is current (mid-superset).
const MID = play(SHAPE, [["begin", 20, 0], ["done", 20, 0], ["done", 20, 1], ["done", 20, 2], ["done", 21, 0], ["done", 22, 0], ["done", 21, 1], ["done", 22, 1], ["skip", 21, 2]]);

test("sheet mid-superset: one row per run in tap order, the pair one interleaved group", () => {
  const v = view(MID.shape, MID.log);
  assert.equal(v.kind, "set");
  assert.deepEqual(
    v.sheet.runs.map((r) => ({ ...r, kg: r.kg?.text ?? null })),
    [
      { row: 20, name: "Squat", under: null, dots: ["done", "done"], kg: "100 kg", partner: null, current: false, finished: true, canJump: false },
      { row: 21, name: "Bench", under: null, dots: ["done", "skipped", "upcoming"], kg: "~80 kg", partner: 22, current: false, finished: false, canJump: false },
      { row: 22, name: "Pull-ups", under: null, dots: ["done", "now"], kg: null, partner: 21, current: true, finished: false, canJump: false },
      { row: 23, name: "Wide Grip", under: "Lat Pulldown", dots: ["upcoming", "upcoming"], kg: "50 kg", partner: null, current: false, finished: false, canJump: true },
    ],
  );
  const groups = v.sheet.groups.map((g) => ({ runs: g.runs, pair: g.pair, segments: g.segments.map((x) => `${x.ref.row}#${x.ref.set}:${x.state}`) }));
  assert.deepEqual(groups, [
    { runs: [20], pair: false, segments: ["20#1:done", "20#2:done"] },
    { runs: [21, 22], pair: true, segments: ["21#1:done", "22#1:done", "21#2:skipped", "22#2:now", "21#3:upcoming"] },
    { runs: [23], pair: false, segments: ["23#1:upcoming", "23#2:upcoming"] },
  ]);
});

test("a reload: the same log and session order (read back as rows) give the same view", () => {
  const { log, shape } = play(SHAPE, [["jump", 23, 1], ["done", 23, 0], ["done", 23, 1]], MID.log, 20);
  assert.deepEqual(shape.runRows, [20, 23, 21, 22]);
  const live = view(shape, log);
  // Reload: the rows come back from the database (JSON), the order from session_order's run_rows.
  const reread = new Map(JSON.parse(JSON.stringify([...log])) as [string, LoggedSet][]);
  const order: SetRef[] = clientOrder(EXERCISES, PAIRS, JSON.parse(JSON.stringify(shape.runRows)) as number[]);
  assert.deepEqual(order, shapeOrder(shape));
  assert.deepEqual(fokusView({ exercises: EXERCISES, pairs: PAIRS, order, week: 2, session: 1 }, reread), live);
  assert.equal(live.kind === "set" ? `${live.next.row}#${live.next.set}` : null, "23#2");
  assert.deepEqual(live.sheet.runs.map((r) => r.row), [20, 23, 21, 22]);
});

test("a jump right after Begynd moves Begynd's start to C's warm-up; a retry changes nothing", () => {
  const shape: SessionShape = { sets: runSetsOf(EXERCISES), pairs: [], runRows: null };
  const begun = play(shape, [["begin", 20, 0]]);
  const { log, shape: after } = play(shape, [["jump", 23, 1]], begun.log, 1);
  assert.deepEqual(after.runRows, [23, 20, 21, 22]);
  assert.equal(log.get("23#0")?.startedAt, T(0)); // Begynd's own time, now C's
  assert.equal(log.has("20#0"), false); // the passed warm-up's start cleared, its empty row gone
  assert.equal(undoesOf(log, { row: 23, set: 0 }), "begin"); // Fortryd still undoes Begynd, now on C
  const v = view(after, log);
  assert.equal(v.kind, "warmup");
  assert.equal(v.kind === "warmup" ? v.since : null, T(0));
  const retry = applyTap(shapeOrder(after), log, "jump", { row: 23, set: 1 }, T(2), null, new Map(), after);
  assert.deepEqual(retry, log);
});

test("the finished view: every row finished, none jumps", () => {
  const all = shapeOrder(SHAPE).filter((r) => r.set !== 0);
  const { log } = play(SHAPE, [["begin", 20, 0], ...all.map((r): [string, number, number] => ["done", r.row, r.set])]);
  const v = view(SHAPE, log);
  assert.equal(v.kind, "finished");
  assert.ok(v.sheet.runs.every((r) => r.finished && !r.canJump && !r.current));
});
