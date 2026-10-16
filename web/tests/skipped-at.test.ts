/**
 * Slice skipped-at (user, 2026-10-16): the skip tap's time lives in exercise_set_log.skipped_at,
 * never in updated_at. updated_at is the row's latest write, so a later write to a skipped row
 * (a hand fix in Supabase, a future field) used to move the skip in time: Fortryd then undid the
 * wrong set and the rest timer stopped counting. Synthetic data only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSetLogRow, RowError } from "../src/lib/db/rows.ts";
import {
  applyTap,
  type LoggedSet,
  lastTap,
  restStart,
  sessionOrder,
  setKey,
  startAfter,
  transition,
  undoesOf,
} from "../src/lib/set-taps.ts";

const ORDER = sessionOrder([
  { row: 25, set: 1 },
  { row: 25, set: 2 },
  { row: 26, set: 1 },
  { row: 26, set: 2 },
]);
const at = (hhmm: string) => `2026-10-12T${hhmm}:00.000Z`;

/** 25#1 done 08:05, 25#2 skipped 08:06, 26#1 done 08:09; 26#2 open (started by 26#1's done). */
function session(): Map<string, LoggedSet> {
  let log: Map<string, LoggedSet> = new Map();
  log = applyTap(ORDER, log, "begin", { row: 25, set: 1 }, at("08:02"));
  log = applyTap(ORDER, log, "done", { row: 25, set: 1 }, at("08:05"));
  log = applyTap(ORDER, log, "skip", { row: 25, set: 2 }, at("08:06"));
  log = applyTap(ORDER, log, "done", { row: 26, set: 1 }, at("08:09"));
  return log;
}

/** A later write to the skipped row (e.g. a hand fix): only its updated_at moves. */
function handFix(log: ReadonlyMap<string, LoggedSet>, hhmm: string): Map<string, LoggedSet> {
  const next = new Map(log);
  const k = setKey({ row: 25, set: 2 });
  const row = next.get(k);
  assert.ok(row?.skipped, "25#2 is skipped");
  next.set(k, { ...row, updatedAt: at(hhmm) });
  return next;
}

test("a skip writes skipped_at = T together with skipped", () => {
  const skipped = session().get(setKey({ row: 25, set: 2 }));
  assert.equal(skipped?.skipped, true);
  assert.equal(skipped.skippedAt, at("08:06"));
});

test("a later write to a skipped row moves neither Fortryd's target nor the rest start", () => {
  const before = session();
  const after = handFix(before, "08:30"); // later than every tap of the session
  assert.deepEqual(lastTap(before), { ref: { row: 26, set: 1 }, kind: "done", at: at("08:09") });
  assert.deepEqual(lastTap(after), lastTap(before), "Fortryd's target");
  assert.equal(restStart(after), at("08:09"), "the rest timer counts from 26#1's done");
  assert.equal(restStart(after), restStart(before));
  assert.equal(undoesOf(after, { row: 26, set: 1 }), "done");
});

test("the skip time read after a hand fix: the next set's start, a skip retry and an undo of the skip", () => {
  // The skip is the session's latest tap here: 26#1 started at the skip's time.
  let log: Map<string, LoggedSet> = new Map();
  log = applyTap(ORDER, log, "begin", { row: 25, set: 1 }, at("08:02"));
  log = applyTap(ORDER, log, "done", { row: 25, set: 1 }, at("08:05"));
  log = applyTap(ORDER, log, "skip", { row: 25, set: 2 }, at("08:06"));
  const fixed = handFix(log, "08:30");
  const skip = { row: 25, set: 2 };
  assert.deepEqual(lastTap(fixed), { ref: skip, kind: "skip", at: at("08:06") });
  assert.equal(startAfter(fixed.get(setKey(skip))), at("08:06"));
  // A retry of the skip finishes with the skip's own time, not the row's latest write.
  const retry = transition(ORDER, fixed, { kind: "skip", target: skip, undoes: null, value: null }, at("08:31"), new Map());
  assert.ok(retry !== null);
  assert.ok(retry.every((c) => (c.op === "ensure" || c.op === "patch" ? c.updatedAt === at("08:06") : true)), JSON.stringify(retry));
  // The undo clears the starts the skip wrote (08:06), so 26#1's start goes and 25#2 is open again.
  const undone = applyTap(ORDER, fixed, "undo", skip, at("08:32"));
  assert.equal(undone.get(setKey({ row: 26, set: 1 })), undefined, "26#1's start (the skip's) is cleared");
  const reopened = undone.get(setKey(skip));
  assert.equal(reopened?.skipped, false);
  assert.equal(reopened.skippedAt, null);
  assert.equal(reopened.startedAt, at("08:05"), "25#2's start comes back from 25#1's end");
  // A done on a skipped set (the overview tick) clears both.
  const unskipped = applyTap(ORDER, fixed, "done", skip, at("08:33")).get(setKey(skip));
  assert.equal(unskipped?.skipped, false);
  assert.equal(unskipped.skippedAt, null);
});

test("parseSetLogRow: skipped_at exactly on a skipped row (the table's check), strict both ways", () => {
  const base = { date: "2026-10-12", session_no: 1, row_no: 25, set_no: 2, kind: "set", started_at: null, ended_at: null, updated_at: at("08:30"), felt_rpe: null, reps_done: null };
  assert.equal(parseSetLogRow({ ...base, skipped: true, skipped_at: at("08:06") }).skippedAt, at("08:06"));
  assert.equal(parseSetLogRow({ ...base, skipped: false, skipped_at: null }).skippedAt, null);
  assert.throws(() => parseSetLogRow({ ...base, skipped: true, skipped_at: null }), RowError);
  assert.throws(() => parseSetLogRow({ ...base, skipped: false, skipped_at: at("08:06") }), RowError);
  assert.throws(() => parseSetLogRow({ ...base, skipped: true, skipped_at: "not a time" }), RowError);
});
