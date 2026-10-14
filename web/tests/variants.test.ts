import assert from "node:assert/strict";
import { test } from "node:test";

import type { TrainingPlanData } from "../src/lib/db/queries.ts";
import {
  parseExerciseFeelRow,
  parsePlannedSetRow,
  parsePrescribedSetRow,
  type PlannedSetRow,
  type PrescribedSetRow,
  RowError,
} from "../src/lib/db/rows.ts";
import { feelRows } from "../src/lib/analyse-styrke-view.ts";
import {
  feelQuestion,
  kgBlock,
  nextSetSummary,
  setInContext,
  setSentence,
  warmupTitle,
} from "../src/lib/fokus-view.ts";
import {
  buildTrainingPlan,
  checklistView,
  exerciseRuns,
  isNewVariant,
  NEW_VARIANT_TEXT,
  runCountText,
  spokenSetLine,
} from "../src/lib/training-view.ts";

// variants.md (2026-10-14): a set's variant from strength_sets.variant_id + exercise_variants.display_name.

const RAW = {
  week_start: "2026-10-12",
  session: 1,
  sheet_id: "s",
  block: "B",
  week: 3,
  sheet_row: 40,
  set_no: 1,
  name: "Bicep of choice",
  type: "BICEPS",
  sets_text: "3",
  reps_text: "20 - 30",
  prescribed: "RPE 8 - 9",
  logged_kg: null,
  bodyweight: false,
  notes: null,
};

test("parsePrescribedSetRow: the display name verbatim; equal to the exercise name is no variant; both or neither", () => {
  const named = parsePrescribedSetRow({ ...RAW, variant_id: 7, exercise_variants: { display_name: "DB Preacher Curl" } });
  assert.deepEqual([named.variantId, named.variant], [7, "DB Preacher Curl"]);
  const same = parsePrescribedSetRow({ ...RAW, variant_id: 7, exercise_variants: { display_name: " bicep OF choice " } });
  assert.deepEqual([same.variantId, same.variant], [7, null]);
  const none = parsePrescribedSetRow({ ...RAW, variant_id: null, exercise_variants: null });
  assert.deepEqual([none.variantId, none.variant], [null, null]);
  assert.throws(() => parsePrescribedSetRow({ ...RAW, variant_id: 7, exercise_variants: null }), RowError);
  assert.throws(() => parsePrescribedSetRow({ ...RAW, variant_id: null, exercise_variants: { display_name: "X" } }), RowError);
  assert.throws(() => parsePrescribedSetRow({ ...RAW, variant_id: 7, exercise_variants: { display_name: " " } }), RowError);
  assert.throws(() => parsePrescribedSetRow({ ...RAW, variant_id: "7", exercise_variants: { display_name: "X" } }), RowError);
});

test("planned_sets: basis new_variant parses without a suggestion, never with one", () => {
  const raw = {
    sheet_id: "s", block: "B", sheet_row: 40, week: 3, set_no: 1, suggested_kg: null, basis: "new_variant",
    uncapped_kg: null, adjustment_kg: null, adjustment_reason: null, rest_min_s: 90, rest_max_s: 120, ramp: null,
  };
  assert.equal(parsePlannedSetRow(raw).basis, "new_variant");
  assert.throws(() => parsePlannedSetRow({ ...raw, suggested_kg: 10 }), RowError);
});

function set(overrides: Partial<PrescribedSetRow>): PrescribedSetRow {
  return {
    weekStart: "2026-10-12", session: 1, block: "B", week: 3, sheetRow: 40, setNo: 1, name: "Bicep of choice", type: "BICEPS",
    setsText: "1", repsText: "20 - 30", prescribed: "RPE 8 - 9", loggedKg: null, bodyweight: false, notes: null,
    variantId: null, variant: null, ...overrides,
  };
}

const PREVIOUS = { week: 2, weekStart: "2026-10-05" } as const;
const PREACHER = { variantId: 2, variant: "DB Preacher Curl" } as const;
const PUSHDOWN = { variantId: 1, variant: "Single arm cable triceps pushdown" } as const;

function plan(sets: PrescribedSetRow[], previousWeek: PrescribedSetRow[], plannedSets: PlannedSetRow[] = []) {
  const data: TrainingPlanData = {
    weekStart: "2026-10-12",
    sessions: [{ weekStart: "2026-10-12", session: 1, block: "B", week: 3, activityId: null, date: null, activityName: null, movingTimeS: null, tss: 0 }],
    sets, previousWeek, rides: [], upcomingRides: [], plannedSets, setLog: [], setLogFailed: false,
  };
  const next = buildTrainingPlan(data, "2026-10-14").strength.next;
  assert.ok(next !== null);
  return next;
}

test("last week only from a set with the same variant_id (null matches only null)", () => {
  const next = plan(
    [set({ sheetRow: 40, ...PREACHER }), set({ sheetRow: 41, name: "Tricep of choice", ...PUSHDOWN }), set({ sheetRow: 42, name: "Dips" })],
    [
      set({ ...PREVIOUS, sheetRow: 40, loggedKg: 9 }), // ukendt last week: no match for the named variant
      set({ ...PREVIOUS, sheetRow: 41, name: "Tricep of choice", loggedKg: 12, ...PUSHDOWN }),
      set({ ...PREVIOUS, sheetRow: 42, name: "Dips", loggedKg: 10, ...PUSHDOWN }), // a variant last week: no match for ukendt
    ],
  );
  assert.deepEqual(
    next.exercises.map((e) => [e.variant, e.reference?.kg ?? null, isNewVariant(e, next.week)]),
    [["DB Preacher Curl", null, true], ["Single arm cable triceps pushdown", 12, false], [null, null, false]],
  );
});

test("Træning sr: collapsed count and set rows name the variant, then the exercise (variants.md §2)", () => {
  const next = plan(
    [1, 2, 3].map((n) => set({ setNo: n, setsText: "3", ...PREACHER })),
    [set({ ...PREVIOUS, sheetRow: 41, name: "Tricep of choice", loggedKg: 9, ...PUSHDOWN })],
  );
  const view = checklistView(next.exercises, next.order, new Map());
  const [run] = exerciseRuns(view.groups);
  assert.deepEqual([run.variant, run.name, runCountText(run)], ["DB Preacher Curl", "Bicep of choice", "0 af 3 sæt udført"]);
  const e = next.exercises[0];
  assert.equal(
    spokenSetLine(e, 3, { ...view.groups[0].sets[0], next: false }),
    "DB Preacher Curl, Bicep of choice, sæt 1 af 3, 20 til 30 reps ved RPE 8 til 9, ny variant, intet fra sidste uge",
  );
  assert.match(spokenSetLine({ ...e, reference: { kg: 9, bodyweight: false } }, 3, view.groups[0].sets[1]), /, sidste uge 9 kg$/);
  // Week 1 keeps its own text: no last-week part at all.
  assert.doesNotMatch(spokenSetLine(e, 1, view.groups[0].sets[1]), /sidste uge/);
});

test("a row naming another variant starts its own run: title, count and set numbers follow it", () => {
  const next = plan(
    [set({ sheetRow: 40, setNo: 1, setsText: "2" }), set({ sheetRow: 40, setNo: 2, setsText: "2" }),
     set({ sheetRow: 41, setNo: 1, setsText: "1", ...PREACHER })],
    [],
  );
  const view = checklistView(next.exercises, next.order, new Map());
  const runs = exerciseRuns(view.groups);
  assert.deepEqual(runs.map((r) => [r.variant, r.name, r.total]), [[null, "Bicep of choice", 2], ["DB Preacher Curl", "Bicep of choice", 1]]);
  assert.deepEqual(view.groups.map((g) => g.sets.map((l) => `${l.n} af ${l.of}`)), [["1 af 2", "2 af 2"], ["1 af 1"]]);
});

test("Fokus: titles, status, warm-up, next set, feel question and the new-variant kg block (variants.md §3)", () => {
  const next = plan([1, 2, 3].map((n) => set({ setNo: n, setsText: "3", ...PREACHER })), []);
  const s2 = setInContext(next.exercises, { row: 40, set: 2 });
  assert.ok(s2 !== null);
  assert.match(setSentence(s2, 3), /^DB Preacher Curl, Bicep of choice, sæt 2 af 3: .*, ny variant, intet fra sidste uge\.$/);
  assert.equal(warmupTitle(s2.exercise), "Opvarmning · DB Preacher Curl");
  assert.deepEqual(nextSetSummary(s2, false, 3), {
    title: "DB Preacher Curl · sæt 2 af 3",
    exercise: "Bicep of choice",
    line: "20–30 reps · RPE 8–9",
    kg: null,
    newVariant: NEW_VARIANT_TEXT,
  });
  assert.equal(nextSetSummary(s2, true, 3).title, "Sæt 2 af 3");
  assert.equal(nextSetSummary(s2, true, 3).exercise, null);
  const s3 = setInContext(next.exercises, { row: 40, set: 3 });
  assert.ok(s3 !== null);
  assert.equal(feelQuestion(s3, true), "Hvordan var sæt 3 i DB Preacher Curl?");
  assert.deepEqual(kgBlock(s2.exercise, 3), { kind: "new_variant", text: "Ny variant – intet fra sidste uge" });
  assert.equal(kgBlock(s2.exercise, 1), null); // week 1 keeps its own text
});

test("Analyse › Styrke feel lines carry the variant; the ukendt line first, keys unique", () => {
  const rows = [
    parseExerciseFeelRow({ exercise_id: 16, variant_id: 7, rated_n: 4, verdict_text: "Du melder oftest lettere end foreskrevet.", exercises: { name: "Bicep of choice" }, exercise_variants: { display_name: "DB Preacher Curl" } }),
    parseExerciseFeelRow({ exercise_id: 16, variant_id: null, rated_n: 5, verdict_text: "Du melder oftest som foreskrevet.", exercises: { name: "Bicep of choice" }, exercise_variants: null }),
  ];
  const lines = feelRows(rows);
  assert.deepEqual(lines.map((l) => [l.id, l.name, l.variant]), [["16#ukendt", "Bicep of choice", null], ["16#7", "Bicep of choice", "DB Preacher Curl"]]);
});
