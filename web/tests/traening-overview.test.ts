import assert from "node:assert/strict";
import { test } from "node:test";

import { formatClock, spokenSigned } from "../src/lib/format.ts";
import { type LoggedSet, sessionOrderWithWarmups, setKey, type SetRef } from "../src/lib/set-taps.ts";
import {
  checklistView,
  compactPrescription,
  type ExerciseView,
  exerciseRuns,
  formSentence,
  lastWeekText,
  runCountText,
  runPositions,
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
    suggestionCapped: false,
    adjustmentKg: null,
    adjustmentReason: null,
    restMinS: null,
    restMaxS: null,
    ramp: null,
    notes: null,
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

test("suggestion: kg, never 0 kg", () => {
  assert.deepEqual(suggestionView(row(1)), { kg: "142,5 kg", capped: false });
  assert.deepEqual(suggestionView(row(1, { suggestedKg: 75, suggestionCapped: true })), { kg: "75 kg", capped: true });
  assert.deepEqual(suggestionView(row(1, { suggestedKg: null, suggestionBasis: "not_rpe" })), { kg: null });
  assert.deepEqual(suggestionView(row(1, { suggestedKg: 0 })), { kg: null });
});

test("last week", () => {
  assert.equal(lastWeekText(row(1), 1), undefined);
  assert.equal(lastWeekText(row(1), 3), "140 kg");
  assert.equal(lastWeekText(row(1, { reference: null }), 3), null);
  assert.equal(lastWeekText(row(1, { reference: { kg: 10, bodyweight: true } }), 3), "kropsvægt + 10 kg");
});

test("checklist: Begynd begins the open warm-up (set 0); the highlight stays on set 1", () => {
  const exercises = [row(10), row(11), row(20, { name: "Bench press" })];
  const order = sessionOrderWithWarmups(exercises.flatMap((e) => e.sets.map((ref) => ({ ref, name: e.name }))));
  const empty = checklistView(exercises, order, new Map());
  assert.deepEqual([empty.beginAt, empty.first], [{ row: 10, set: 0 }, { row: 10, set: 1 }]);
  // Warm-up begun: Fortsæt begins nothing new (the warm-up is still the first open entry).
  const begun = checklistView(exercises, order, logOf([{ row: 10, set: 0, startedAt: AT }]));
  assert.deepEqual(begun.beginAt, { row: 10, set: 0 });
  // Squat done: the next open entry is Bench press's warm-up.
  const squatDone = logOf([
    { row: 10, set: 0, startedAt: AT, endedAt: AT },
    ...[10, 11].flatMap((r) => [1, 2].map((set) => ({ row: r, set, startedAt: AT, endedAt: AT }))),
  ]);
  assert.deepEqual(checklistView(exercises, order, squatDone).beginAt, { row: 20, set: 0 });
});

test("checklist: next on the first open set's group, progress", () => {
  const exercises = [row(10), row(11), row(20, { name: "Bench press" })];
  const order = exercises.flatMap((e) => e.sets);
  const empty = checklistView(exercises, order, new Map());
  assert.equal(empty.primary, "begin");
  assert.deepEqual(empty.first, { row: 10, set: 1 });
  assert.deepEqual(
    empty.groups.map((g) => g.isNext),
    [true, false, false],
  );
  assert.equal(empty.groups[0].sets[0].next, true);

  // Row 10 done and skipped: the next group moves to row 11.
  const log = logOf([
    { row: 10, set: 1, startedAt: AT, endedAt: AT },
    { row: 10, set: 2, skipped: true },
  ]);
  const mid = checklistView(exercises, order, log);
  assert.equal(mid.primary, "continue");
  assert.deepEqual(mid.groups.map((g) => [g.isNext, g.closed]), [
    [false, true],
    [true, false],
    [false, false],
  ]);
  assert.deepEqual(mid.progress, { done: 1, skipped: 1, total: 6 });
  assert.deepEqual(mid.segments, ["done", "skipped", "open", "open", "open", "open"]);
  assert.equal(setStatus(mid.groups[0].sets[0]), "kl. 18.42");
  assert.equal(setStatus(mid.groups[0].sets[1]), "sprunget over");
  assert.equal(setStatus(mid.groups[1].sets[0]), null);
});

test("checklist: every set closed has no next group and is finished", () => {
  const exercises = [row(10, {}, 1)];
  const view = checklistView(exercises, exercises[0].sets, logOf([{ row: 10, set: 1, skipped: true }]));
  assert.equal(view.primary, "finished");
  assert.equal(view.first, null);
  assert.equal(view.groups[0].isNext, false);
  assert.equal(view.groups[0].closed, true);
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
    "Squat, sæt 2 af 2, 8 til 12 reps ved RPE 5 til 7, intet logget sidste uge",
  ); // no suggestion: nothing about one is said (review round §8)
  assert.doesNotMatch(spokenSetLine(ranged, 3, checklistView([ranged], ranged.sets, new Map()).groups[0].sets[0]), /forslag/i);
  // Week 1: no last-week part.
  assert.equal(spokenSetLine(e, 1, open.groups[0].sets[1]), "Squat, sæt 2 af 2, 5 reps ved RPE 7, forslag 142,5 kg");
});

test("D11: sets are numbered across the run (same trimmed name, consecutive rows), not per row", () => {
  // Real shape: Bænk is 3 rows with 1 + 1 + 2 sets; a trailing space still joins the run.
  const exercises = [
    row(10, { name: "Bænk" }, 1),
    row(11, { name: "Bænk " }, 1),
    row(12, { name: "Bænk" }, 2),
    row(20, { name: "Dips" }, 2),
    row(30, { name: "Bænk" }, 1), // not consecutive: a run of its own
  ];
  const runs = runPositions(exercises);
  const at = (r: number, n: number) => runs.get(setKey({ row: r, set: n }));
  assert.deepEqual([at(10, 1), at(11, 1), at(12, 1), at(12, 2)], [
    { index: 1, of: 4 },
    { index: 2, of: 4 },
    { index: 3, of: 4 },
    { index: 4, of: 4 },
  ]);
  assert.deepEqual([at(20, 1), at(20, 2), at(30, 1)], [
    { index: 1, of: 2 },
    { index: 2, of: 2 },
    { index: 1, of: 1 },
  ]);

  const view = checklistView(exercises, exercises.flatMap((e) => e.sets), new Map());
  assert.deepEqual(
    view.groups.slice(0, 3).flatMap((g) => g.sets.map((l) => `${l.n} af ${l.of}`)),
    ["1 af 4", "2 af 4", "3 af 4", "4 af 4"],
  );
  assert.match(spokenSetLine(exercises[2], 3, view.groups[2].sets[1]), /^Bænk, sæt 4 af 4, /);
});

test("warm-ups never show as ticks: the list, the segments and NÆSTE skip set 0", async () => {
  const { sessionOrderWithWarmups } = await import("../src/lib/set-taps.ts");
  const exercises = [row(10, {}, 2), row(11, { name: "Dips" }, 1)];
  const order = sessionOrderWithWarmups(exercises.flatMap((e) => e.sets.map((ref) => ({ ref, name: e.name }))));
  assert.equal(order.filter((r) => r.set === 0).length, 2);
  const view = checklistView(exercises, order, new Map());
  assert.equal(view.segments.length, 3);
  assert.ok(view.groups.every((g) => g.sets.every((l) => l.ref.set !== 0)));
  assert.deepEqual(view.first, { row: 10, set: 1 });
  assert.equal(view.groups[0].sets[0].next, true);
  assert.equal(view.progress.total, 3);
});

test("compactPrescription: sets × reps, RPE as @, other load cells as written, ranges as one figure", () => {
  assert.equal(compactPrescription(row(10, {}, 3)), "3 × 5 @7");
  assert.equal(compactPrescription(row(10, { repsText: "6 - 10", prescribed: "RPE 7 - 8" }, 3)), "3 × 6–10 @7–8");
  assert.equal(compactPrescription(row(10, { prescribed: "-12.5%" }, 2)), "2 × 5 -12.5%");
  assert.equal(compactPrescription(row(10, { repsText: null, prescribed: null })), null);
});

test("exerciseRuns: same-named rows fold into one exercise with joined prescription, dots and counts", () => {
  const exercises = [
    row(10, { key: "B#10", prescribed: "RPE 6" }, 1),
    row(11, { key: "B#11", prescribed: "RPE 7", suggestedKg: null, suggestionBasis: "no_e1rm" }, 1),
    row(12, { key: "B#12", name: "Dips", prescribed: "RPE 8" }, 2),
  ];
  const order = exercises.flatMap((e) => e.sets);
  const view = checklistView(exercises, order, logOf([{ row: 10, set: 1, startedAt: AT, endedAt: AT }]));
  const runs = exerciseRuns(view.groups);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].name, "Squat");
  assert.equal(runs[0].prescription, "1 × 5 @6 · 1 × 5 @7");
  assert.equal(runs[0].isNext, true);
  assert.equal(runs[0].focus.key, "B#11"); // the NÆSTE row's values show in the head
  assert.deepEqual(
    runs[0].dots.map((d) => [d.state, d.next]),
    [
      ["done", false],
      ["open", true],
    ],
  );
  assert.equal(runCountText(runs[0]), "1 af 2 sæt udført");
  assert.equal(runs[1].isNext, false);
  const skipped = exerciseRuns(checklistView(exercises, order, logOf([{ row: 12, set: 1, skipped: true }])).groups);
  assert.equal(runCountText(skipped[1]), "0 af 2 sæt udført, 1 sprunget over");
});
