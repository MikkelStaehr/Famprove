// range-order (user, 2026-10-20): the sheet's intervals are shown exactly as written, also
// reversed ("RPE 7-5", "10 - 6"); every calculation on them uses min and max, never the order.
import assert from "node:assert/strict";
import { test } from "node:test";

import { drawingReps } from "../src/lib/fokus-marks.ts";
import {
  type FokusExercise,
  nextSetSummary,
  prescribedCell,
  rangeFigure,
  repsRange,
  setInContext,
  setSentence,
  stepperValue,
} from "../src/lib/fokus-view.ts";
import { rangeTop, rangeTops, setKey } from "../src/lib/set-taps.ts";
import { compactPrescription } from "../src/lib/training-view.ts";

const exercise = (repsText: string, prescribed: string): FokusExercise => ({
  name: "Leg curl",
  variant: null,
  variantId: null,
  repsText,
  prescribed,
  bodyweight: false,
  reference: null,
  row: 6,
  suggestedKg: null,
  suggestionBasis: "not_rpe",
  suggestionCapped: false,
  adjustmentKg: null,
  adjustmentReason: null,
  restMinS: null,
  restMaxS: null,
  ramp: null,
  todayKg: null,
  todayBasis: null,
  sets: [{ row: 6, set: 1 }],
});

test("range-order: a reversed reps range has the same bounds, top and midpoint as the sheet's usual order", () => {
  assert.deepEqual(repsRange("10 - 6"), repsRange("6 - 10"));
  assert.deepEqual(repsRange("10 - 6"), { low: 6, top: 10 });
  assert.deepEqual(repsRange("12–8"), { low: 8, top: 12 });
  assert.equal(repsRange("8 - 8"), null); // one number twice is not a range
  assert.equal(rangeTop("10 - 6"), 10);
  assert.equal(rangeTop("10 - 6"), rangeTop("6 - 10"));
  assert.equal(rangeTop("12,5 - 10"), 12.5);
  const rows = [{ repsText: "10 - 6", sets: [{ row: 6, set: 1 }] }];
  assert.equal(rangeTops(rows).get(setKey({ row: 6, set: 1 })), 10); // what a done stores as reps
  assert.equal(stepperValue(null, repsRange("10 - 6")?.top ?? 0), 10);
  const reversed = { name: "Leg curl", row: 6, repsText: "10 - 6" };
  assert.equal(drawingReps(reversed, undefined), 8);
  assert.equal(drawingReps(reversed, undefined), drawingReps({ ...reversed, repsText: "6 - 10" }, undefined));
});

test("range-order: every shown text keeps the sheet's order", () => {
  assert.equal(rangeFigure("10 - 6"), "10–6"); // also the reps stepper's range line
  assert.equal(rangeFigure("RPE 7-5"), "RPE 7–5");
  assert.deepEqual(prescribedCell("RPE 7-5"), { caption: "RPE", value: "7–5", unit: null });
  assert.deepEqual(prescribedCell("RPE 7 - 5"), { caption: "RPE", value: "7–5", unit: null });
  assert.equal(compactPrescription({ sets: [{ row: 6, set: 1 }, { row: 6, set: 2 }], repsText: "10 - 6", prescribed: "RPE 7-5" }), "2 × 10–6 @7–5");
  const e = exercise("10 - 6", "RPE 7 - 5");
  const s = setInContext([e], { row: 6, set: 1 });
  assert.ok(s !== null);
  assert.equal(nextSetSummary(s, false, 2).line, "10–6 reps · RPE 7–5");
  assert.match(setSentence(s, 2), /10 til 6 reps ved RPE 7 til 5/);
});
