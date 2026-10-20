import assert from "node:assert/strict";
import { test } from "node:test";

import type { TrainingPlanData } from "../src/lib/db/queries.ts";
import type { ExerciseCategoryRow, PlannedSetRow, PrescribedSetRow, StrengthSessionRow } from "../src/lib/db/rows.ts";
import { bodyweightWords } from "../src/lib/format.ts";
import { referenceText } from "../src/lib/fokus-view.ts";
import { buildTrainingPlan, lastWeekItem, todayKgView } from "../src/lib/training-view.ts";

// bw-display (user, 2026-10-20): "kropsvægt + X kg" only on a pure bodyweight exercise (the set's
// bodyweight AND the catalogue's category "bodyweight"); a split squat with a bodyweight fraction
// shows its logged kg alone. Wired through the real view builder, as Træning and Fokus build it.

const BLOK = "Program - blok 12 (offseason)";
const WEEK = "2026-10-19";
const LAST_WEEK = "2026-10-12";
const SPLIT = "Zercher FFE split squat";

const CATALOGUE: readonly ExerciseCategoryRow[] = [
  { name: SPLIT, aliases: [], category: "accessory" },
  { name: "Dips", aliases: ["dip"], category: "bodyweight" },
];

function set(sheetRow: number, name: string, weekStart: string, week: number, loggedKg: number | null): PrescribedSetRow {
  return {
    weekStart,
    session: 1,
    block: BLOK,
    week,
    sheetRow,
    setNo: 1,
    name,
    type: name === SPLIT ? "SQUAT" : "UPPER",
    setsText: "1",
    repsText: "8",
    prescribed: "RPE 7",
    loggedKg,
    bodyweight: true, // both carry a bodyweight fraction in public.exercises
    variantId: null,
    variant: null,
  };
}

function planned(sheetRow: number, todayKg: number): PlannedSetRow {
  return {
    block: BLOK,
    sheetRow,
    week: 2,
    setNo: 1,
    suggestedKg: null,
    basis: "no_lift",
    uncappedKg: null,
    adjustmentKg: null,
    adjustmentReason: null,
    restMinS: null,
    restMaxS: null,
    ramp: null,
    todayKg,
    todayBasis: "sheet",
  };
}

const SESSION: StrengthSessionRow = {
  weekStart: WEEK,
  session: 1,
  block: BLOK,
  week: 2,
  activityId: null,
  date: null,
  activityName: null,
  movingTimeS: null,
  tss: 0, // undone
};

const DATA: TrainingPlanData = {
  weekStart: WEEK,
  sessions: [SESSION],
  sets: [set(40, SPLIT, WEEK, 2, null), set(41, "Dips", WEEK, 2, null)],
  previousWeek: [set(40, SPLIT, LAST_WEEK, 1, 42.5), set(41, "Dips", LAST_WEEK, 1, 10)],
  rides: [],
  upcomingRides: [],
  plannedSets: [planned(40, 42.5), planned(41, 10)],
  setLog: [],
  setLogFailed: false,
};

function exercises(categories: readonly ExerciseCategoryRow[] | null) {
  const next = buildTrainingPlan(DATA, "2026-10-19", categories).strength.next;
  assert.ok(next !== null);
  const split = next.exercises.find((e) => e.name === SPLIT);
  const dips = next.exercises.find((e) => e.name === "Dips");
  assert.ok(split !== undefined && dips !== undefined);
  return { split, dips, week: next.week };
}

test("a split squat shows its logged kg alone, a dip 'kropsvægt + 10 kg' (bw-display)", () => {
  const { split, dips, week } = exercises(CATALOGUE);
  assert.equal(todayKgView(split)?.spoken, "i dag 42,5 kg");
  assert.equal(todayKgView(split)?.unit, "kg");
  assert.deepEqual(lastWeekItem({ ...split, todayBasis: "sheet" }, week), { kind: "kg", text: "42,5 kg" });
  assert.ok(split.reference !== null);
  assert.equal(referenceText(split.reference), "42,5 kg");

  assert.equal(todayKgView(dips)?.spoken, "i dag kropsvægt + 10 kg");
  assert.deepEqual(lastWeekItem(dips, week), { kind: "kg", text: "kropsvægt + 10 kg" });
  assert.ok(dips.reference !== null);
  assert.equal(referenceText(dips.reference), "kropsvægt + 10 kg");
});

test("an unread catalogue keeps the set's bodyweight words, so a dip never shows a bare '10 kg'", () => {
  const { split, dips } = exercises(null);
  assert.equal(todayKgView(dips)?.spoken, "i dag kropsvægt + 10 kg");
  assert.equal(todayKgView(split)?.spoken, "i dag kropsvægt + 42,5 kg");
});

test("bodyweightWords: pure bodyweight only; null catalogue keeps the set's flag", () => {
  assert.equal(bodyweightWords(true, "bodyweight"), true);
  assert.equal(bodyweightWords(true, "accessory"), false);
  assert.equal(bodyweightWords(false, "bodyweight"), false);
  assert.equal(bodyweightWords(true, null), true);
  assert.equal(bodyweightWords(false, null), false);
});
