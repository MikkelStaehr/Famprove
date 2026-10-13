import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseExerciseFeelRow, RowError } from "../src/lib/db/rows.ts";

// Python's real output (python/tests/test_contract_exercise_feel.py writes it).
const rows: unknown[] = JSON.parse(readFileSync(new URL("./fixtures/exercise_feel.json", import.meta.url), "utf8"));

test("contract: every exercise_feel row Python writes parses; the sentence passes through verbatim", () => {
  const parsed = rows.map(parseExerciseFeelRow);
  assert.deepEqual(
    parsed.map((r) => [r.name, r.ratedN]),
    [["Bænk", 4], ["Low incline DB press", 4], ["Lat pulldowns", 4]],
  );
  assert.equal(parsed[0]?.verdictText, (rows[0] as { verdict_text: string }).verdict_text);
  assert.ok(parsed.every((r) => !/Benjamin/.test(r.verdictText)), "no coach name in a public repo");
});

test("exercise_feel: fewer than 4 rated sets or an empty sentence is refused", () => {
  const row = rows[0] as Record<string, unknown>;
  assert.throws(() => parseExerciseFeelRow({ ...row, rated_n: 3 }), RowError);
  assert.throws(() => parseExerciseFeelRow({ ...row, verdict_text: " " }), RowError);
  assert.throws(() => parseExerciseFeelRow({ ...row, exercises: null }), RowError);
});
