import assert from "node:assert/strict";
import { test } from "node:test";

import { doneLabel, fokusState, type SetInContext } from "../src/lib/fokus-view.ts";
import { type LoggedSet, sessionOrderWithWarmups, setKey, type SetRef } from "../src/lib/set-taps.ts";
import {
  clientOrder,
  clientPairs,
  handOffLabel,
  handOffName,
  orderPairs,
  pairHandOff,
  pairLine,
  refusedText,
  restWindowOf,
  SEAM_IDLE,
  seamReducer,
  seamState,
  seamViews,
  slotKey,
} from "../src/lib/superset-view.ts";
import type { PairSlot } from "../src/lib/supersets.ts";

type Row = {
  name: string;
  variant: string | null;
  variantId: number | null;
  row: number;
  sets: SetRef[];
  restMinS: number | null;
  restMaxS: number | null;
};

function row(r: number, name: string, n: number, rest: [number, number]): Row {
  const sets = Array.from({ length: n }, (_, k) => ({ row: r, set: k + 1 }));
  return { name, variant: null, variantId: null, row: r, sets, restMinS: rest[0], restMaxS: rest[1] };
}

/** Bench (A, 90–180 s) then Pull-ups (B, 180–300 s), then a lone Curl. */
function session(aSets: number, bSets: number): Row[] {
  return [row(10, "Bench", aSets, [90, 180]), row(11, "Pull-ups", bSets, [180, 300]), row(12, "Curl", 2, [60, 120])];
}
const PAIRS = [{ rowA: 10, rowB: 11 }];

function orderOf(rows: readonly Row[]): SetRef[] {
  return sessionOrderWithWarmups(rows.flatMap((e) => e.sets.map((ref) => ({ ref, name: e.name, variantId: e.variantId }))), PAIRS);
}

const T0 = Date.parse("2026-10-15T17:00:00Z");
/** Each ref in `done` done in turn, a minute apart. */
function logOf(done: readonly SetRef[]): Map<string, LoggedSet> {
  const log = new Map<string, LoggedSet>();
  done.forEach((ref, i) => {
    const at = new Date(T0 + i * 60_000).toISOString();
    log.set(setKey(ref), { ...ref, startedAt: at, endedAt: at, skipped: false, skippedAt: null, updatedAt: at });
  });
  return log;
}

const working = (order: readonly SetRef[]) => order.filter((s) => s.set !== 0 && s.row !== 12).map(setKey);

test("S10/S17: 3 + 3 runs in tap order A1 B1 A2 B2 A3 B3, warm-ups A0 B0 first", () => {
  const order = orderOf(session(3, 3));
  assert.deepEqual(order.slice(0, 2).map(setKey), ["10#0", "11#0"]);
  assert.deepEqual(working(order), ["10#1", "11#1", "10#2", "11#2", "10#3", "11#3"]);
});

test("S10/S16: 4 + 3 ends with A4 alone", () => {
  assert.deepEqual(working(orderOf(session(4, 3))), ["10#1", "11#1", "10#2", "11#2", "10#3", "11#3", "10#4"]);
});

test("S12: A's working done reads Videre til B; the warm-ups run alone (user 2026-10-16); B's and the tail's don't", () => {
  const rows = session(4, 3);
  assert.equal(handOffName(rows, PAIRS, { row: 10, set: 2 }, { row: 11, set: 2 }), "Pull-ups");
  assert.equal(handOffName(rows, PAIRS, { row: 10, set: 0 }, { row: 11, set: 0 }), null); // A0 → B0: two solo warm-ups
  assert.equal(handOffName(rows, PAIRS, { row: 11, set: 0 }, { row: 10, set: 1 }), null); // B0 → A1: the superset starts
  assert.equal(handOffName(rows, PAIRS, { row: 10, set: 1 }, { row: 11, set: 1 }), "Pull-ups");
  assert.equal(pairLine(rows, PAIRS, { row: 10, set: 0 }), null);
  assert.equal(pairLine(rows, PAIRS, { row: 11, set: 0 }), null);
  assert.equal(handOffName(rows, PAIRS, { row: 11, set: 2 }, { row: 10, set: 3 }), null);
  assert.equal(handOffName(rows, PAIRS, { row: 10, set: 4 }, { row: 12, set: 0 }), null);
  const label = handOffLabel("Pull-ups", { number: 2, count: 4 }, "Bench");
  assert.deepEqual(label, { visible: "Videre til Pull-ups", spoken: "Videre til Pull-ups, sæt 2 af 4 udført, Bench" });
});

test("fokus-flow §5 / WCAG 2.5.3: the done's accessible name starts with its visible words", () => {
  const e = row(10, "Squat", 4, [180, 300]);
  const label = doneLabel({ exercise: e as unknown as SetInContext["exercise"], ref: { row: 10, set: 2 }, number: 2, count: 4 });
  assert.deepEqual(label, { visible: "Sæt 2 udført", spoken: "Sæt 2 udført, 2 af 4, Squat" });
  assert.ok(label.spoken.startsWith(label.visible));
});

test("S13/S14: showRest is false after A and true after B", () => {
  const rows = session(3, 3);
  const order = orderOf(rows);
  const handOff = (a: SetRef, n: SetRef) => pairHandOff(rows, PAIRS, a, n);
  const afterA = fokusState(order, logOf([{ row: 10, set: 0 }, { row: 11, set: 0 }, { row: 10, set: 1 }]), handOff);
  assert.equal(afterA.kind, "set");
  if (afterA.kind === "set") {
    assert.deepEqual(afterA.next, { row: 11, set: 1 });
    assert.equal(afterA.showRest, false);
  }
  const afterB = fokusState(order, logOf([{ row: 10, set: 0 }, { row: 11, set: 0 }, { row: 10, set: 1 }, { row: 11, set: 1 }]), handOff);
  assert.equal(afterB.kind, "set");
  if (afterB.kind === "set") {
    assert.deepEqual(afterB.next, { row: 10, set: 2 });
    assert.equal(afterB.showRest, true);
  }
});

test("R3: the rest after B uses the whole window of the run with the larger rest_max_s; after a warm-up its own", () => {
  const rows = session(3, 3);
  const afterB = restWindowOf(rows, PAIRS, { row: 11, set: 1 });
  assert.equal(afterB?.superset, true);
  assert.deepEqual([afterB?.row.restMinS, afterB?.row.restMaxS], [180, 300]);
  assert.equal(restWindowOf(rows, PAIRS, { row: 11, set: 0 })?.superset, false); // B0 runs alone
  assert.equal(restWindowOf(rows, PAIRS, { row: 10, set: 0 })?.superset, false);
  // The larger window on A's side wins as a whole.
  const flipped = [{ ...rows[0], restMinS: 120, restMaxS: 360 }, rows[1], rows[2]];
  assert.deepEqual([restWindowOf(flipped, PAIRS, { row: 11, set: 2 })?.row.restMinS, restWindowOf(flipped, PAIRS, { row: 11, set: 2 })?.row.restMaxS], [120, 360]);
  // Outside a pair: the set's own window.
  assert.equal(restWindowOf(rows, PAIRS, { row: 12, set: 1 })?.superset, false);
});

test("S11/S16: the pair line, and the tail runs alone with its own window", () => {
  const rows = session(4, 3);
  assert.equal(pairLine(rows, PAIRS, { row: 10, set: 2 }), "Superset med Pull-ups · den følger uden pause");
  assert.equal(pairLine(rows, PAIRS, { row: 11, set: 2 }), "Superset med Bench · pause bagefter");
  assert.equal(pairLine(rows, PAIRS, { row: 10, set: 4 }), "Alene – Pull-ups er færdig");
  assert.equal(pairLine(rows, PAIRS, { row: 12, set: 1 }), null);
  const tail = restWindowOf(rows, PAIRS, { row: 10, set: 4 });
  assert.deepEqual([tail?.superset, tail?.row.restMaxS], [false, 180]);
});

// --- Træning: the seam ------------------------------------------------------------------------

const slot = (paired: boolean, source: PairSlot["source"], locked: boolean): PairSlot => ({ rowA: 10, rowB: 11, paired, source, locked });

test("S3: the seam's five states from pairSlots", () => {
  assert.equal(seamState(slot(false, null, false)), "available");
  assert.equal(seamState(slot(true, "suggested", false)), "suggested");
  assert.equal(seamState(slot(true, "today", false)), "paired");
  assert.equal(seamState(slot(true, "today", true)), "locked");
  assert.equal(seamState(slot(false, null, true)), "none");
});

test("S3/S4: a logged set of A (not A's warm-up begin) locks the pair; B's other neighbour is not offered", () => {
  const rows = session(3, 3);
  const slots: PairSlot[] = [slot(true, "today", false), { rowA: 11, rowB: 12, paired: false, source: null, locked: true }];
  const pairs = clientPairs(slots, new Map());
  const begun = seamViews(rows, slots, pairs, [{ row: 10, set: 0 }]);
  assert.deepEqual(begun.map((v) => v.state), ["paired", "none"]);
  const started = seamViews(rows, slots, pairs, [{ row: 10, set: 0 }, { row: 10, set: 1 }]);
  assert.equal(started[0].state, "locked");
  assert.equal(started[0].started, "Bench");
  assert.equal(started[0].both, "Bench og Pull-ups");
});

test("S6–S8: optimistic, failed and refused transitions", () => {
  const tapped = seamReducer(SEAM_IDLE, { kind: "tap", paired: true });
  assert.deepEqual(tapped, { override: true, status: "saving" });
  assert.deepEqual(seamReducer(tapped, { kind: "result", result: { ok: true, pairs: [] } }), { override: true, status: "idle" });
  assert.deepEqual(seamReducer(tapped, { kind: "result", result: { ok: false, reason: "dev" } }), { override: true, status: "idle" });
  // S7: lost or failed keeps the choice and shows Gem igen.
  assert.deepEqual(seamReducer(tapped, { kind: "result", result: null }), { override: true, status: "failed" });
  assert.deepEqual(seamReducer(tapped, { kind: "result", result: { ok: false, reason: "failed" } }), { override: true, status: "failed" });
  // S8: a refusal returns to the stored state.
  assert.deepEqual(seamReducer(tapped, { kind: "result", result: { ok: false, reason: "started" } }), { override: null, status: "refused", reason: "started" });
});

test("S8: each refusal reason has its own line", () => {
  const v = { started: "Bench" };
  assert.equal(refusedText(v, "started"), "Supersettet kan ikke ændres, fordi Bench er gået i gang.");
  assert.match(refusedText(v, "overlap"), /andet superset/);
  assert.match(refusedText(v, "not_today"), /på dagen/);
  assert.match(refusedText(v, "not_consecutive"), /genindlæs/);
  assert.equal(refusedText(v), refusedText(v, "started"));
});

test("a failed save stays on the seam but not in the tap order (reviewer: server and client order agree)", () => {
  const slots: PairSlot[] = [{ rowA: 10, rowB: 11, paired: false, source: null, locked: false }];
  const failed = new Map([["10-11", { override: true, status: "failed" as const }]]);
  const saving = new Map([["10-11", { override: true, status: "saving" as const }]]);
  assert.deepEqual(clientPairs(slots, failed), [{ rowA: 10, rowB: 11, source: "today" }]);
  assert.deepEqual(orderPairs(slots, failed), []);
  assert.deepEqual(orderPairs(slots, saving), [{ rowA: 10, rowB: 11, source: "today" }]);
});

test("S5: a fresh switch changes the client's tap order", () => {
  const rows = session(2, 2);
  const slots: PairSlot[] = [slot(false, null, false)];
  const off = clientPairs(slots, new Map());
  assert.deepEqual(off, []);
  const on = clientPairs(slots, new Map([[slotKey(slots[0]), { override: true, status: "saving" as const }]]));
  assert.deepEqual(on, [{ rowA: 10, rowB: 11, source: "today" }]);
  assert.deepEqual(working(clientOrder(rows, on)), ["10#1", "11#1", "10#2", "11#2"]);
  // A suggestion switched off is no pair.
  const suggested: PairSlot[] = [slot(true, "suggested", false)];
  assert.deepEqual(clientPairs(suggested, new Map([[slotKey(suggested[0]), { override: false, status: "idle" as const }]])), []);
});
