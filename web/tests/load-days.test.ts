import assert from "node:assert/strict";
import { test } from "node:test";

import {
  barDays,
  barTop,
  beforeLogSpan,
  curveScale,
  curveWindow,
  dayCell,
  gridWeeks,
  shadeLevel,
  strengthLogStart,
} from "../src/lib/load-days.ts";

const day = (date: string, cyclingTss: number, strengthTss: number) => ({ date, cyclingTss, strengthTss, totalTss: cyclingTss + strengthTss });

test("shade buckets on whole total TSS: 0 · 1–49 · 50–99 · 100+", () => {
  assert.deepEqual([0, 0.4, 0.5, 49, 49.4, 49.5, 99, 99.6, 100, 230].map(shadeLevel), [0, 0, 1, 1, 1, 2, 2, 3, 3, 3]);
});

test("strength log start is the earliest block start; null without blocks", () => {
  assert.equal(strengthLogStart([{ startDate: "2026-09-21" }, { startDate: "2026-08-10" }]), "2026-08-10");
  assert.equal(strengthLogStart([]), null);
});

test("before the log: a ride day is shaded by its total, strength not registered; no ride is unknown, never rest", () => {
  const ride = dayCell("2026-08-01", day("2026-08-01", 60, 0), "2026-08-10");
  assert.deepEqual([ride.level, ride.strength, ride.unknown, ride.total], [2, null, false, 60]);
  const none = dayCell("2026-08-02", day("2026-08-02", 0, 0), "2026-08-10");
  assert.deepEqual([none.level, none.unknown, none.total], [null, true, null]);
  const after = dayCell("2026-08-10", day("2026-08-10", 0, 0), "2026-08-10");
  assert.deepEqual([after.level, after.unknown, after.strength], [0, false, 0]);
  // A missing daily_load row is unknown, not 0.
  assert.equal(dayCell("2026-09-01", undefined, "2026-08-10").unknown, true);
});

test("grid: 12 ISO weeks Mon–Sun ending with today's week; days after today are null", () => {
  const weeks = gridWeeks([day("2026-10-14", 0, 72)], "2026-10-14", "2026-08-10");
  assert.equal(weeks.length, 12);
  assert.equal(weeks[11].weekStart, "2026-10-12");
  assert.equal(weeks[0].weekStart, "2026-07-27");
  assert.equal(weeks[11].days[2]?.level, 2);
  assert.deepEqual(weeks[11].days.slice(3), [null, null, null, null]);
});

test("bars: window ends today, top rounded up to 50, before-log span", () => {
  const rows = [day("2026-08-08", 40, 0), day("2026-08-11", 80, 72)];
  const cells = barDays(rows, "2026-08-12", 6, "2026-08-10");
  assert.deepEqual(cells.map((c) => c.date), ["2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12"]);
  assert.equal(barTop(cells), 200);
  assert.equal(barTop([]), 50);
  assert.deepEqual(beforeLogSpan(cells), [0, 2]);
  assert.equal(beforeLogSpan(barDays(rows, "2026-08-12", 2, "2026-08-10")), null);
});

test("curve ranges: 4U 28 days + 14, 12U 84 + 28, season from the series start + 56", () => {
  assert.deepEqual(curveWindow("4U", "2026-10-14", "2026-01-01"), { from: "2026-09-17", to: "2026-10-28" });
  assert.deepEqual(curveWindow("12U", "2026-10-14", "2026-01-01"), { from: "2026-07-23", to: "2026-11-11" });
  assert.deepEqual(curveWindow("season", "2026-10-14", "2026-01-01"), { from: "2026-01-01", to: "2026-12-09" });
  assert.equal(curveWindow("12U", "2026-02-01", "2026-01-01").from, "2026-01-01");
});

test("curve gridlines: three multiples of 10 over the extent rounded out to 10", () => {
  assert.deepEqual(curveScale(8.4, 26.1), { lo: 0, hi: 30, lines: [10, 20, 30] });
  assert.deepEqual(curveScale(12, 49), { lo: 10, hi: 70, lines: [30, 50, 70] });
});
