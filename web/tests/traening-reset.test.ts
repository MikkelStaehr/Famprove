import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blockWeekCaption,
  exerciseNames,
  sessionSummary,
  shortDay,
  updatedCaption,
  weekdayLabel,
} from "../src/lib/training-view.ts";

const names = (...n: string[]) => n.map((name) => ({ name }));

test("exerciseNames: distinct names in sheet order, runs merged, three then 'og N øvelser mere'", () => {
  assert.equal(exerciseNames(names("Squat")), "Squat");
  assert.equal(exerciseNames(names("Squat", "Squat ", "Bench")), "Squat og Bench");
  assert.equal(exerciseNames(names("Dødløft", "Dips", "Pulldown")), "Dødløft, Dips og Pulldown");
  assert.equal(
    exerciseNames(names("Dødløft", "Dips", "Pulldown", "Curl", "Dødløft", "Plank", "Row")),
    "Dødløft, Dips, Pulldown og 3 øvelser mere",
  );
  assert.equal(exerciseNames(names("A", "B", "C", "D")), "A, B, C og 1 øvelse mere");
  assert.equal(exerciseNames([]), "");
});

test("sessionSummary: the set total until a set is touched, then done of total", () => {
  const ex = names("Squat");
  assert.equal(sessionSummary(ex, { done: 0, skipped: 0, total: 5 }), "Squat · 5 sæt");
  assert.equal(sessionSummary(ex, { done: 0, skipped: 1, total: 5 }), "Squat · 0 af 5 sæt udført");
  assert.equal(sessionSummary(ex, { done: 7, skipped: 1, total: 19 }), "Squat · 7 af 19 sæt udført");
});

test("blockWeekCaption: the block's number when the name has one, else as written", () => {
  assert.equal(blockWeekCaption("Program - blok 12 (offseason)", 3), "Blok 12 · uge 3");
  assert.equal(blockWeekCaption("Deload", 1), "Deload · uge 1");
});

test("shortDay and weekdayLabel: the InverseCard day and the ListRow day", () => {
  assert.equal(shortDay("2026-10-14"), "ons 14");
  assert.equal(weekdayLabel("2026-10-13"), "Tir");
  assert.equal(weekdayLabel("2026-10-14"), "Ons");
  assert.equal(weekdayLabel("2026-10-18"), "Søn");
});

test("updatedCaption: time only today, the date otherwise, 'forældet' when stale", () => {
  // 03:00Z = 05:00 Copenhagen (CEST).
  assert.equal(updatedCaption({ kind: "fresh", computedAt: "2026-10-14T03:00:00Z" }, "2026-10-14"), "opdateret 05.00");
  assert.equal(
    updatedCaption({ kind: "fresh", computedAt: "2026-10-13T18:00:00Z" }, "2026-10-14"),
    "opdateret 13. okt. 20.00",
  );
  assert.equal(
    updatedCaption({ kind: "stale", computedAt: "2026-10-13T03:00:00Z" }, "2026-10-14"),
    "forældet · opdateret 13. okt. 05.00",
  );
  assert.equal(updatedCaption({ kind: "unknown" }, "2026-10-14"), "opdatering ukendt");
});
