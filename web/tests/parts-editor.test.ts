import assert from "node:assert/strict";
import { test } from "node:test";

import { COMBO_VARIANT, comboParts } from "../src/lib/db/dev-fixture.ts";
import {
  canDecrease,
  draftFrom,
  KG_ERROR,
  KG_HIGH_ERROR,
  kgError,
  parseKg,
  parseReps,
  partsEditorView,
  partsToSave,
  REPS_ERROR,
  repsError,
  stepKg,
  stepReps,
} from "../src/lib/parts-editor.ts";
import { partsFor } from "../src/lib/set-parts.ts";

const TODAY = "2026-10-19";

test("snapshot: the editor's view model for DEV_FIXTURE=combo", () => {
  const parts = partsFor(comboParts(TODAY), 1, { row: 40, set: 2 }, COMBO_VARIANT.variantId);
  assert.ok(parts !== null);
  assert.deepEqual(partsEditorView(draftFrom(parts), null), {
    caption: "Dele i sæt 2",
    group: "Dele i sæt 2, valgfrit",
    rows: [
      {
        partNo: 1,
        name: "Split squat",
        kg: "12,5",
        reps: "8",
        perSide: true,
        labels: {
          toggle: "Split squat tæller pr. side",
          kgLess: "Færre kg, Split squat",
          kgMore: "Flere kg, Split squat",
          repsLess: "Færre reps, Split squat",
          repsMore: "Flere reps, Split squat",
          kgInput: "Kg, Split squat",
          repsInput: "Reps, Split squat",
        },
      },
      {
        partNo: 2,
        name: "Calf raise",
        kg: "20",
        reps: "12",
        perSide: false,
        labels: {
          toggle: "Calf raise tæller pr. side",
          kgLess: "Færre kg, Calf raise",
          kgMore: "Flere kg, Calf raise",
          repsLess: "Færre reps, Calf raise",
          repsMore: "Flere reps, Calf raise",
          kgInput: "Kg, Calf raise",
          repsInput: "Reps, Calf raise",
        },
      },
    ],
    // R2: pre-filled from last time, so saved untouched.
    save: [
      { partNo: 1, kg: 12.5, reps: 8, perSide: true },
      { partNo: 2, kg: 20, reps: 12, perSide: false },
    ],
    dirty: true,
  });
});

test("a superset names the exercise in the caption (S15)", () => {
  const parts = partsFor(comboParts(TODAY), 1, { row: 40, set: 3 }, COMBO_VARIANT.variantId);
  assert.ok(parts !== null);
  const view = partsEditorView(draftFrom(parts), "Split Squat + Calf Raise");
  assert.equal(view.caption, "Dele i sæt 3 · Split Squat + Calf Raise");
  assert.equal(view.group, "Dele i sæt 3 · Split Squat + Calf Raise, valgfrit");
});

test("a never-logged part shows –, never 0, and saves nothing", () => {
  const data = { ...comboParts(TODAY), last: [] };
  const parts = partsFor(data, 1, { row: 40, set: 1 }, COMBO_VARIANT.variantId);
  assert.ok(parts !== null);
  const view = partsEditorView(draftFrom(parts), null);
  assert.deepEqual(view.rows.map((r) => [r.kg, r.reps]), [["–", "–"], ["–", "–"]]);
  assert.deepEqual(view.save, []);
});

test("logged parts need no save", () => {
  const data = comboParts(TODAY);
  const own = { date: TODAY, session: 1, row: 40, set: 2, partNo: 1, variantId: COMBO_VARIANT.variantId, kg: 15, reps: 8, perSide: true, updatedAt: `${TODAY}T10:00:00Z` };
  const parts = partsFor({ ...data, today: [own, { ...own, partNo: 2, kg: 0, reps: 10, perSide: false }] }, 1, { row: 40, set: 2 }, COMBO_VARIANT.variantId);
  assert.ok(parts !== null);
  const draft = draftFrom(parts);
  assert.equal(draft.dirty, false);
  assert.deepEqual(draft.parts.map((p) => p.kgText), ["15", "0"]); // kg 0 is a real value
});

test("typed values: comma or dot kg, whole reps over 0 (§5)", () => {
  assert.equal(parseKg("12,5"), 12.5);
  assert.equal(parseKg("12.5"), 12.5);
  assert.equal(parseKg(" "), null);
  assert.equal(parseKg("abc"), undefined);
  assert.equal(parseKg("0"), 0);
  assert.equal(kgError("abc"), KG_ERROR);
  assert.equal(kgError("301"), KG_HIGH_ERROR);
  assert.equal(kgError("300"), null);
  assert.equal(parseReps("0"), undefined);
  assert.equal(parseReps("8,5"), undefined);
  assert.equal(repsError("0"), REPS_ERROR);
  assert.equal(repsError(""), null);
});

test("steps: kg by 2.5, reps by 1, floors 0 and 1 (R1)", () => {
  assert.equal(stepKg("12,5", 1), "15");
  assert.equal(stepKg("12", -1), "9,5");
  assert.equal(stepKg("1", -1), "0");
  assert.equal(stepKg("", 1), "2,5");
  assert.equal(stepKg("", -1), "");
  assert.equal(stepKg("abc", 1), "abc");
  assert.equal(stepReps("8", 1), "9");
  assert.equal(stepReps("1", -1), "1");
  assert.equal(stepReps("", 1), "1");
  assert.equal(canDecrease("0", "kg"), false);
  assert.equal(canDecrease("1", "reps"), false);
  assert.equal(canDecrease("2", "reps"), true);
});

test("an invalid part is not saved, the rest are (§5)", () => {
  const draft = {
    row: 40,
    set: 2,
    dirty: true,
    parts: [
      { partNo: 1, name: "A", kgText: "abc", repsText: "8", perSide: true },
      { partNo: 2, name: "B", kgText: "", repsText: "12", perSide: false },
    ],
  };
  assert.deepEqual(partsToSave(draft), [{ partNo: 2, kg: null, reps: 12, perSide: false }]);
});
