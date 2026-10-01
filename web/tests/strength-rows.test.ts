import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { illustrativeLogged, LSRPE_POINTS } from "../src/lib/db/dev-fixture.ts";
import { parseSheetOneRmRow, parseStrengthBlockRow, parseStrengthWeekRow, RowError } from "../src/lib/db/rows.ts";

function fixture(): unknown[] {
  const raw: unknown = JSON.parse(readFileSync(new URL("./fixtures/strength_weeks.json", import.meta.url), "utf8"));
  assert.ok(Array.isArray(raw) && raw.length > 0);
  return raw;
}

// Contract (CLAUDE.md): the fixture is Python's own output, written by
// python/tests/test_contract_strength_analysis.py from the real producer. Regenerate it there.
test("contract: every strength_weeks row Python writes parses, edge cases included", () => {
  const weeks = fixture().map(parseStrengthWeekRow);
  assert.deepEqual([...new Set(weeks.map((w) => w.status ?? "none"))].sort(), ["lifted", "none", "pre_log"]);
  assert.deepEqual([...new Set(weeks.map((w) => w.e1rmRpeSource ?? "none"))].sort(), ["logged", "none", "prescribed"]);
  assert.deepEqual([...new Set(weeks.map((w) => w.phase ?? "none"))].sort(), ["in_season", "none", "off_season"]);
  assert.ok(weeks.some((w) => w.block === null && w.blockNo === null));
  assert.ok(weeks.some((w) => w.setsLifted > 0 && w.e1rmKg === null));
  assert.ok(weeks.every((w) => (w.e1rmKg === null) === (w.e1rmRpeSource === null)));
  assert.ok(weeks.every((w) => !w.isBlockBest || w.e1rmKg !== null));
  assert.ok(weeks.some((w) => w.setsLifted === 0 && w.tonnageKg === 0 && w.status === null));
});

test("strength rows reject unknown enum values and numeric strings", () => {
  const [first] = fixture();
  assert.ok(typeof first === "object" && first !== null);
  assert.throws(() => parseStrengthWeekRow({ ...first, lift: "CURL" }), RowError);
  assert.throws(() => parseStrengthWeekRow({ ...first, phase: "summer" }), RowError);
  assert.throws(() => parseStrengthWeekRow({ ...first, status: "planned" }), RowError);
  assert.throws(() => parseStrengthWeekRow({ ...first, tonnage_kg: "100" }), RowError);
  const block = { name: "Program - blok 12", block_no: 12, start_date: "2026-09-28", end_date: null, deload_start: null, phase: "off_season" };
  assert.equal(parseStrengthBlockRow(block).phase, "off_season");
  assert.equal(parseStrengthBlockRow({ ...block, phase: null }).phase, null);
  assert.throws(() => parseStrengthBlockRow({ ...block, phase: "x" }), RowError);
  assert.deepEqual(parseSheetOneRmRow({ block: "b", type: "BENCH", e1rm: 102.5 }), { block: "b", lift: "BENCH", kg: 102.5 });
  assert.throws(() => parseSheetOneRmRow({ block: "b", type: "BACK", e1rm: 50 }), RowError);
});

test("DEV_FIXTURE=lsrpe marks the latest e1RM points per lift as logged, values unchanged", () => {
  const weeks = fixture().map(parseStrengthWeekRow);
  const shown = illustrativeLogged(weeks);
  assert.equal(shown.length, weeks.length);
  for (const lift of ["SQUAT", "BENCH", "DEADLIFT"] as const) {
    const points = shown.filter((w) => w.lift === lift && w.e1rmKg !== null);
    const logged = points.filter((w) => w.e1rmRpeSource === "logged");
    assert.equal(logged.length, Math.min(LSRPE_POINTS, points.length));
  }
  assert.deepEqual(shown.map((w) => w.e1rmKg), weeks.map((w) => w.e1rmKg));
});
