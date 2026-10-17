import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSessionOrderRow } from "../src/lib/db/rows.ts";
import { type FokusExercise, fokusView } from "../src/lib/fokus-view.ts";
import {
  applyChanges,
  applyOrderChanges,
  lastTap,
  type LoggedSet,
  type SessionShape,
  type SetTapKind,
  shapeOrder,
  transition,
  undoesOf,
} from "../src/lib/set-taps.ts";
import { runSetsOf } from "../src/lib/superset-view.ts";

// Fortryd of a jump (slice jump-undo, user 2026-10-17): one Fortryd goes back to before the jump,
// or before a whole chain of jumps in a row. Played through the shared transition, as Fokus does.

function ex(row: number, name: string, n: number): FokusExercise {
  return {
    name, variant: null, variantId: null, repsText: "5", prescribed: null, bodyweight: false, reference: null, row,
    suggestedKg: null, suggestionBasis: null, suggestionCapped: false, adjustmentKg: null, adjustmentReason: null,
    restMinS: 90, restMaxS: 180, ramp: null, todayKg: null, todayBasis: null,
    sets: Array.from({ length: n }, (_, k) => ({ row, set: k + 1 })),
  };
}

const EXERCISES: readonly FokusExercise[] = [ex(25, "Squat", 3), ex(26, "Bench", 2), ex(27, "Facepulls", 2)];
const SHAPE: SessionShape = { sets: runSetsOf(EXERCISES), pairs: [], runRows: null };
const T = (m: number) => new Date(Date.parse("2026-10-12T08:00:00.000Z") + m * 60_000).toISOString();

type State = { readonly log: ReadonlyMap<string, LoggedSet>; readonly shape: SessionShape };
type Step = readonly [SetTapKind | "fortryd", number, number];

/** One tap as Fokus makes it: "fortryd" = the latest tap with the shape (a jump, with the jump it saw). */
function tap(s: State, [kind, row, set]: Step, at: string): State {
  const order = shapeOrder(s.shape);
  const latest = kind === "fortryd" ? lastTap(s.log, s.shape) : null;
  const target = latest === null ? { row, set } : latest.ref;
  const real: SetTapKind = kind === "fortryd" ? "undo" : kind;
  const undoes = real === "undo" ? (undoesOf(s.log, target, kind === "fortryd" ? s.shape : undefined) ?? "done") : null;
  const seen = undoes === "jump" ? (s.shape.jump?.jumpedAt ?? null) : null;
  const changes = transition(order, s.log, { kind: real, target, undoes, value: null, seen }, at, new Map(), s.shape);
  return changes === null ? s : { log: applyChanges(s.log, changes), shape: applyOrderChanges(s.shape, changes) };
}

function play(steps: readonly Step[], from: State = { log: new Map(), shape: SHAPE }, m0 = 0): State {
  return steps.reduce((s, step, k) => tap(s, step, T(m0 + k)), from);
}

/** What the screens read: every set's times (not updated_at) and the tap order. */
function seen(s: State) {
  const log = [...s.log.values()].map((l) => [l.row, l.set, l.startedAt, l.endedAt, l.skipped, l.skippedAt]).toSorted((a, b) => Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1]));
  return { log, order: shapeOrder(s.shape) };
}

const view = (s: State) => fokusView({ exercises: EXERCISES, pairs: [], order: shapeOrder(s.shape), week: 2, session: 1, shape: s.shape }, s.log);

// Squat warmed up and set 1 done: Squat 2 is current, its start = set 1's end.
const BEFORE = play([["begin", 25, 0], ["done", 25, 0], ["done", 25, 1]]);

test("jump, then Fortryd: the order and the moved start are back", () => {
  const jumped = play([["jump", 27, 1]], BEFORE, 10);
  assert.notDeepEqual(seen(jumped).order, seen(BEFORE).order);
  assert.equal(jumped.log.get("25#2"), undefined); // its start moved to Facepulls' warm-up
  assert.equal(jumped.log.get("27#0")?.startedAt, BEFORE.log.get("25#2")?.startedAt);
  const v = view(jumped);
  assert.equal(v.undo?.kind, "tap");
  assert.equal(v.undo?.line, "Fortryd spring til Facepulls");
  assert.deepEqual(v.undo?.ref, { row: 27, set: 0 });
  const back = play([["fortryd", 0, 0]], jumped, 11);
  assert.deepEqual(seen(back), seen(BEFORE));
  assert.equal(back.shape.jump, null);
  // Fortryd now undoes Squat 1's done, as before the jump.
  assert.deepEqual(lastTap(back.log, back.shape)?.ref, { row: 25, set: 1 });
});

test("jump, jump, then one Fortryd: back to before the first jump", () => {
  const chain = play([["jump", 26, 1], ["jump", 27, 1]], BEFORE, 10);
  assert.deepEqual(chain.shape.jump?.previousRows, [25, 26, 27]);
  assert.equal(chain.shape.jump?.movedStart, BEFORE.log.get("25#2")?.startedAt);
  assert.equal(chain.shape.jump?.jumpedAt, T(11));
  const back = play([["fortryd", 0, 0]], chain, 12);
  assert.deepEqual(seen(back), seen(BEFORE));
});

test("jump, Fortryd, jump: the new jump starts fresh", () => {
  const again = play([["jump", 26, 1], ["fortryd", 0, 0], ["jump", 27, 1]], BEFORE, 10);
  assert.deepEqual(again.shape.jump, { previousRows: [25, 26, 27], jumpedAt: T(12), movedStart: BEFORE.log.get("25#2")?.startedAt ?? null });
  assert.deepEqual(seen(play([["fortryd", 0, 0]], again, 13)), seen(BEFORE));
});

test("jump, done, Fortryd: undoes the done, not the jump; a second Fortryd undoes the jump", () => {
  const jumped = play([["jump", 27, 1]], BEFORE, 10);
  const done = play([["done", 27, 0]], jumped, 11);
  assert.equal(lastTap(done.log, done.shape)?.kind, "done");
  const one = play([["fortryd", 0, 0]], done, 12);
  assert.deepEqual(seen(one), seen(jumped)); // the done is gone, the jump stands
  assert.equal(lastTap(one.log, one.shape)?.kind, "jump");
  assert.deepEqual(seen(play([["fortryd", 0, 0]], one, 13)), seen(BEFORE));
});

test("a tie between a done and a jump goes to the done", () => {
  const jumped = play([["jump", 27, 1]], BEFORE, 10);
  const tied: State = { ...jumped, shape: { ...jumped.shape, jump: { previousRows: [25, 26, 27], jumpedAt: T(2), movedStart: null } } };
  assert.equal(lastTap(tied.log, tied.shape)?.kind, "done"); // Squat 1 done at T(2)
});

test("reload: the stored row gives the same order, view and Fortryd target", () => {
  const chain = play([["jump", 26, 1], ["jump", 27, 1]], BEFORE, 10);
  const mark = chain.shape.jump;
  assert.ok(mark != null);
  const row = parseSessionOrderRow({
    date: "2026-10-12", session_no: 1, run_rows: chain.shape.runRows, updated_at: mark.jumpedAt,
    previous_rows: mark.previousRows, jumped_at: mark.jumpedAt.replace("Z", "+00:00").replace(".000", ""), moved_start: mark.movedStart,
  });
  const reloaded: State = { log: chain.log, shape: { ...SHAPE, runRows: row.runRows, jump: row.jump } };
  assert.deepEqual(view(reloaded), view(chain));
  assert.deepEqual(lastTap(reloaded.log, reloaded.shape)?.ref, lastTap(chain.log, chain.shape)?.ref);
  assert.deepEqual(seen(play([["fortryd", 0, 0]], reloaded, 12)), seen(BEFORE));
});

test("session_order: jumped_at and previous_rows are null together", () => {
  const base = { date: "2026-10-12", session_no: 1, run_rows: [25], updated_at: T(0), moved_start: null };
  assert.throws(() => parseSessionOrderRow({ ...base, previous_rows: [25], jumped_at: null }));
  assert.throws(() => parseSessionOrderRow({ ...base, previous_rows: null, jumped_at: T(0) }));
  assert.equal(parseSessionOrderRow({ ...base, previous_rows: null, jumped_at: null }).jump, null);
});

test("an undo of a jump without the jump it saw, or after a done landed, is refused", () => {
  const jumped = play([["jump", 27, 1]], BEFORE, 10);
  const order = shapeOrder(jumped.shape);
  const undo = { kind: "undo" as const, target: { row: 27, set: 0 }, undoes: "jump" as const, value: null };
  assert.equal(transition(order, jumped.log, { ...undo, seen: null }, T(11), new Map(), jumped.shape), null);
  assert.deepEqual(transition(order, jumped.log, { ...undo, seen: T(9) }, T(11), new Map(), jumped.shape), []); // another jump: nothing
  const done = play([["done", 27, 0]], jumped, 11);
  assert.equal(transition(shapeOrder(done.shape), done.log, { ...undo, seen: T(10) }, T(12), new Map(), done.shape), null);
});

test("a first jump records only the start it moves: C's own start is never moved_start, so Fortryd leaves it", () => {
  const log = new Map(BEFORE.log);
  const passed = log.get("25#2");
  assert.ok(passed !== undefined);
  log.set("25#2", { ...passed, startedAt: null }); // the open set holds no start
  const own = T(-30); // Facepulls' warm-up holds a start no tap before the passed set wrote
  log.set("27#0", { row: 27, set: 0, startedAt: own, endedAt: null, skipped: false, skippedAt: null, updatedAt: own });
  const jumped = play([["jump", 27, 1]], { log, shape: SHAPE }, 10);
  assert.equal(jumped.shape.jump?.movedStart, null);
  assert.equal(jumped.log.get("27#0")?.startedAt, own);
  const undone = play([["fortryd", 0, 0]], jumped, 11);
  assert.equal(undone.log.get("27#0")?.startedAt, own); // not moved to Squat 2
  assert.equal(undone.log.get("25#2")?.startedAt ?? null, null);
});
