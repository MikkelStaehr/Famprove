import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseBlockRow,
  parseDailyLoadRow,
  parseWeeklyLoadRow,
  RowError,
} from "../src/lib/db/rows.ts";

const DAILY = {
  date: "2026-09-28",
  cycling_tss: 0,
  strength_tss: 12.5,
  total_tss: 12.5,
  ctl: 17.71,
  atl: 6.88,
  tsb: 10.83,
  ctl_ramp_7d: -3.21,
  form_zone: "fresh",
  computed_at: "2026-09-28T09:12:36.337787+00:00",
};

test("parseDailyLoadRow maps snake_case to camelCase", () => {
  assert.deepEqual(parseDailyLoadRow(DAILY), {
    date: "2026-09-28",
    cyclingTss: 0,
    strengthTss: 12.5,
    totalTss: 12.5,
    ctl: 17.71,
    atl: 6.88,
    tsb: 10.83,
    ctlRamp7d: -3.21,
    formZone: "fresh",
    computedAt: "2026-09-28T09:12:36.337787+00:00",
  });
});

test("parseDailyLoadRow accepts nulls for the M2 columns (pre-M2 rows, first week)", () => {
  const row = parseDailyLoadRow({ ...DAILY, ctl_ramp_7d: null, form_zone: null, computed_at: null });
  assert.equal(row.ctlRamp7d, null);
  assert.equal(row.formZone, null);
  assert.equal(row.computedAt, null);
});

for (const [column, value] of [
  ["ctl", "17.7"],
  ["ctl", true],
  ["ctl", null],
  ["tsb", Number.NaN],
  ["date", "28-09-2026"],
  ["computed_at", "yesterday"],
  ["form_zone", 3],
] as const) {
  test(`parseDailyLoadRow rejects ${column} = ${String(value)} naming the column, not the value`, () => {
    assert.throws(
      () => parseDailyLoadRow({ ...DAILY, [column]: value }),
      (err: unknown) =>
        err instanceof RowError &&
        err.message.startsWith(`daily_load.${column}:`) &&
        !err.message.includes(String(value)),
    );
  });
}

test("parsers reject non-object rows", () => {
  for (const raw of [null, [], "row", 1]) {
    assert.throws(() => parseBlockRow(raw), RowError);
  }
});

test("parseBlockRow keeps nullable end and deload", () => {
  assert.deepEqual(
    parseBlockRow({
      name: "Program - blok 12 (offseason)",
      block_no: 12,
      start_date: "2026-09-28",
      end_date: null,
      deload_start: null,
    }),
    {
      name: "Program - blok 12 (offseason)",
      blockNo: 12,
      startDate: "2026-09-28",
      endDate: null,
      deloadStart: null,
    },
  );
});

test("parseWeeklyLoadRow maps every column", () => {
  const row = parseWeeklyLoadRow({
    week_start: "2026-09-28",
    week_end: "2026-10-04",
    iso_year: 2026,
    iso_week: 40,
    cycling_tss: 0,
    strength_tss: 0,
    total_tss: 0,
    days: 1,
  });
  assert.equal(row.isoWeek, 40);
  assert.equal(row.weekEnd, "2026-10-04");
  assert.equal(row.days, 1);
});
