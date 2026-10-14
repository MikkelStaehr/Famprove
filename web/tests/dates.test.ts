import assert from "node:assert/strict";
import { test } from "node:test";

import { isoWeek, isoWeekStart } from "../src/lib/dates.ts";

test("isoWeek: the week belongs to the year of its Thursday", () => {
  assert.deepEqual(isoWeek("2025-12-29"), { year: 2026, week: 1 }); // Monday of 2026-W01
  assert.deepEqual(isoWeek("2026-01-01"), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek("2026-12-28"), { year: 2026, week: 53 }); // Monday of 2026-W53
  assert.deepEqual(isoWeek("2027-01-01"), { year: 2026, week: 53 }); // Friday: still 2026-W53
  assert.deepEqual(isoWeek("2027-01-04"), { year: 2027, week: 1 });
  assert.deepEqual(isoWeek("2026-09-30"), { year: 2026, week: 40 });
  assert.deepEqual(isoWeek("2026-10-04"), { year: 2026, week: 40 }); // Sunday ends the week
});

test("isoWeekStart: the Monday, across a year boundary", () => {
  assert.equal(isoWeekStart("2026-01-01"), "2025-12-29");
  assert.equal(isoWeekStart("2027-01-03"), "2026-12-28"); // Sunday of 2026-W53
  assert.equal(isoWeekStart("2027-01-04"), "2027-01-04"); // a Monday is its own start
  assert.equal(isoWeekStart("2026-10-04"), "2026-09-28");
});
