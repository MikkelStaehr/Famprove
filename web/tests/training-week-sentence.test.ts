import assert from "node:assert/strict";
import { test } from "node:test";

import type { SetState } from "../src/lib/set-taps.ts";
import { type WeekColumn, weekSentence } from "../src/lib/training-view.ts";

const WEEK: readonly WeekColumn[] = [
  { session: 1, sets: 20, status: "done" },
  { session: 2, sets: 24, status: "current" },
  { session: 3, sets: 18, status: "future" },
];

function states(done: number, skipped: number, total: number): SetState[] {
  return Array.from({ length: total }, (_, i) => (i < done ? "done" : i < done + skipped ? "skipped" : "open"));
}

test("week sentence: done, in progress with counts, not begun", () => {
  assert.equal(
    weekSentence(WEEK, states(7, 1, 24)),
    "Ugen: session 1 udført, session 2 i gang med 7 af 24 sæt, session 3 ikke begyndt.",
  );
  assert.equal(
    weekSentence(WEEK, states(0, 0, 24)),
    "Ugen: session 1 udført, session 2 ikke begyndt, session 3 ikke begyndt.",
  );
  assert.equal(weekSentence(WEEK, states(0, 2, 24)).includes("session 2 i gang med 0 af 24 sæt"), true);
});
