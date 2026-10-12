import assert from "node:assert/strict";
import { test } from "node:test";

import { formatClock, spokenSigned } from "../src/lib/format.ts";
import { type LoggedSet, setKey, type SetRef } from "../src/lib/set-taps.ts";
import {
  checklistView,
  type ExerciseView,
  formSentence,
  lastWeekText,
  repsText,
  setStatus,
  spokenSetLine,
  suggestionView,
  TSB_HINT,
} from "../src/lib/training-view.ts";

function row(row: number, overrides: Partial<ExerciseView> = {}, sets = 2): ExerciseView {
  return {
    key: `B#${row}`,
    name: "Squat",
    type: "SQUAT",
    setsText: String(sets),
    repsText: "5",
    prescribed: "RPE 7",
    bodyweight: false,
    kg: null,
    reference: { kg: 140, bodyweight: false },
    row,
    suggestedKg: 142.5,
    suggestionBasis: "rpe_e1rm",
    sets: Array.from({ length: sets }, (_, i) => ({ row, set: i + 1 })),
    ...overrides,
  };
}

const AT = "2026-10-12T16:42:00Z"; // 18.42 in Copenhagen (CEST)

function logOf(entries: readonly (SetRef & Partial<LoggedSet>)[]): Map<string, LoggedSet> {
  return new Map(
    entries.map((e) => [
      setKey(e),
      { row: e.row, set: e.set, startedAt: e.startedAt ?? null, endedAt: e.endedAt ?? null, skipped: e.skipped ?? false, updatedAt: e.updatedAt ?? AT },
    ]),
  );
}

test("formatClock and spokenSigned", () => {
  assert.equal(formatClock(AT), "kl. 18.42");
  assert.equal(spokenSigned(-24.4), "minus 24");
  assert.equal(spokenSigned(4), "plus 4");
  assert.equal(spokenSigned(-0.2), "0");
});

test("form sentence: zone, no zone, an old row", () => {
  assert.equal(formSentence(-24, "optimal"), "Form minus 24 TSS per dag, optimal. Forvent at ligge lidt under.");
  assert.equal(formSentence(4, null), "Form plus 4 TSS per dag. Zone ikke beregnet.");
  assert.equal(
    formSentence(-24, "optimal", "søndag 11. oktober"),
    "Form minus 24 TSS per dag, optimal. Forvent at ligge lidt under. Tallet er fra søndag 11. oktober.",
  );
  assert.equal(TSB_HINT.high_risk, "Meget træt: forvent at ligge klart under");
});

test("suggestion: kg, reasons per basis, never 0 kg", () => {
  assert.deepEqual(suggestionView(row(1)), { kg: "142,5 kg" });
  assert.deepEqual(suggestionView(row(1, { suggestedKg: null, suggestionBasis: "not_rpe" })), { kg: null, words: "Intet forslag til %-sæt" });
  assert.deepEqual(suggestionView(row(1, { suggestedKg: null, suggestionBasis: "no_e1rm" })), { kg: null, words: "Intet forslag: ingen e1RM endnu" });
  assert.deepEqual(suggestionView(row(1, { suggestedKg: null, suggestionBasis: "no_lift" })), { kg: null, words: "Intet forslag til denne øvelse" });
  assert.deepEqual(suggestionView(row(1, { suggestedKg: null, suggestionBasis: null })), { kg: null, words: "Intet forslag" });
  assert.deepEqual(suggestionView(row(1, { suggestedKg: 0 })), { kg: null, words: "Intet forslag" });
});

test("last week and reps as written", () => {
  assert.equal(lastWeekText(row(1), 1), undefined);
  assert.equal(lastWeekText(row(1), 3), "140 kg");
  assert.equal(lastWeekText(row(1, { reference: null }), 3), null);
  assert.equal(lastWeekText(row(1, { reference: { kg: 10, bodyweight: true } }), 3), "kropsvægt + 10 kg");
  assert.equal(repsText(row(1, { repsText: "8 - 12" })), "8 - 12 reps");
  assert.equal(repsText(row(1, { repsText: null })), null);
});

test("checklist: slab on the first open set's group, runs, dividers, progress", () => {
  const exercises = [row(10), row(11), row(20, { name: "Bench press" })];
  const order = exercises.flatMap((e) => e.sets);
  const empty = checklistView(exercises, order, new Map());
  assert.equal(empty.primary, "begin");
  assert.deepEqual(empty.first, { row: 10, set: 1 });
  assert.deepEqual(empty.groups.map((g) => [g.showName, g.slab, g.dividerBefore]), [
    [true, true, false],
    [false, false, false], // continuation of the Squat run
    [true, false, true], // a new run, not touching the slab
  ]);
  assert.equal(empty.groups[0].sets[0].next, true);

  // Row 10 done and skipped: the slab moves to row 11 (named, since it is NÆSTE); the divider before
  // Bench press goes because the slab touches it.
  const log = logOf([
    { row: 10, set: 1, startedAt: AT, endedAt: AT },
    { row: 10, set: 2, skipped: true },
  ]);
  const mid = checklistView(exercises, order, log);
  assert.equal(mid.primary, "continue");
  assert.deepEqual(mid.groups.map((g) => [g.showName, g.slab, g.closed, g.dividerBefore]), [
    [true, false, true, false],
    [true, true, false, false],
    [true, false, false, false],
  ]);
  assert.equal(mid.groups[0].nameMuted, false); // row 11 of the run is still open
  assert.deepEqual(mid.progress, { done: 1, skipped: 1, total: 6 });
  assert.deepEqual(mid.segments, ["done", "skipped", "open", "open", "open", "open"]);
  assert.equal(setStatus(mid.groups[0].sets[0]), "kl. 18.42");
  assert.equal(setStatus(mid.groups[0].sets[1]), "sprunget over");
  assert.equal(setStatus(mid.groups[1].sets[0]), null);
});

test("checklist: every set closed has no slab and is finished", () => {
  const exercises = [row(10, {}, 1)];
  const view = checklistView(exercises, exercises[0].sets, logOf([{ row: 10, set: 1, skipped: true }]));
  assert.equal(view.primary, "finished");
  assert.equal(view.first, null);
  assert.equal(view.groups[0].slab, false);
  assert.equal(view.groups[0].nameMuted, true);
});

test("set line accessible names (spec §6)", () => {
  const e = row(10);
  const exercises = [e];
  const open = checklistView(exercises, e.sets, new Map());
  assert.equal(
    spokenSetLine(e, 3, open.groups[0].sets[0]),
    "Squat, sæt 1 af 2, 5 reps ved RPE 7, forslag 142,5 kg, sidste uge 140 kg, næste",
  );
  assert.equal(
    spokenSetLine(e, 3, open.groups[0].sets[1]),
    "Squat, sæt 2 af 2, 5 reps ved RPE 7, forslag 142,5 kg, sidste uge 140 kg",
  );
  const done = checklistView(exercises, e.sets, logOf([{ row: 10, set: 1, startedAt: AT, endedAt: AT }]));
  assert.match(spokenSetLine(e, 3, done.groups[0].sets[0]), /, udført kl\. 18\.42$/);
  const ranged = row(10, { repsText: "8 - 12", prescribed: "RPE 5 - 7", suggestedKg: null, suggestionBasis: "not_rpe", reference: null });
  assert.equal(
    spokenSetLine(ranged, 3, checklistView([ranged], ranged.sets, new Map()).groups[0].sets[1]),
    "Squat, sæt 2 af 2, 8 til 12 reps ved RPE 5 til 7, intet forslag, intet logget sidste uge",
  );
  // Week 1: no last-week part.
  assert.equal(spokenSetLine(e, 1, open.groups[0].sets[1]), "Squat, sæt 2 af 2, 5 reps ved RPE 7, forslag 142,5 kg");
});
