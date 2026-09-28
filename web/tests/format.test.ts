import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatDay,
  formatDevice,
  formatDuration,
  formatIf,
  formatKg,
  formatLoad,
  formatScore,
  formatSetLoad,
  formatSigned,
  formatUpdatedAt,
  formatWatts,
  formatWeekParam,
} from "../src/lib/format.ts";

test("formatLoad rounds to whole TSS and never prints -0", () => {
  assert.equal(formatLoad(72.4), "72");
  assert.equal(formatLoad(72.5), "73");
  assert.equal(formatLoad(-0.3), "0");
});

test("formatSigned uses + and a real minus sign", () => {
  assert.equal(formatSigned(5.2), "+5");
  assert.equal(formatSigned(-12.6), "−13");
  assert.equal(formatSigned(-0.3), "0");
  assert.equal(formatSigned(0), "0");
});

test("formatDay formats the calendar date without a time-zone shift", () => {
  assert.equal(formatDay("2026-03-02"), "Mon 2 Mar");
  assert.equal(formatDay("2026-01-01"), "Thu 1 Jan");
});

test("formatUpdatedAt shows Copenhagen time (CEST in summer, CET in winter)", () => {
  assert.equal(formatUpdatedAt("2026-09-28T03:05:00Z"), "28 Sept, 05:05");
  assert.equal(formatUpdatedAt("2026-01-15T23:30:00Z"), "16 Jan, 00:30");
});

test("formatDuration shows h:mm rounded to the minute", () => {
  assert.equal(formatDuration(3720), "1:02");
  assert.equal(formatDuration(2700), "0:45");
  assert.equal(formatDuration(3599), "1:00");
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(36_000), "10:00");
});

test("formatIf turns intervals.icu's percent into a 2-decimal fraction", () => {
  assert.equal(formatIf(85.3), "0.85");
  assert.equal(formatIf(85.5), "0.86");
  assert.equal(formatIf(100), "1.00");
  assert.equal(formatIf(104.9), "1.05");
});

test("formatKg keeps logged decimals without trailing zeros", () => {
  assert.equal(formatKg(120), "120");
  assert.equal(formatKg(22.5), "22.5");
  assert.equal(formatKg(0), "0");
});

test("formatSetLoad names bodyweight, signs the added kg, and is null when nothing was logged", () => {
  assert.equal(formatSetLoad(120, false), "120 kg");
  assert.equal(formatSetLoad(0, false), null);
  assert.equal(formatSetLoad(0, true), "bodyweight");
  assert.equal(formatSetLoad(10, true), "bodyweight + 10 kg");
  assert.equal(formatSetLoad(-12.5, true), "bodyweight − 12.5 kg");
});

test("formatScore rounds the raw score to a whole number", () => {
  assert.equal(formatScore(336.8), "337");
  assert.equal(formatScore(-0.2), "0");
});

test("formatDevice shows the maker readably and never invents one", () => {
  assert.equal(formatDevice("HAMMERHEAD Karoo"), "Hammerhead Karoo");
  assert.equal(formatDevice("WAHOO_FITNESS ELEMNT BOLT"), "Wahoo ELEMNT BOLT");
  assert.equal(formatDevice("Zwift"), "Zwift");
  assert.equal(formatDevice("SOME_MAKER Thing"), "SOME MAKER Thing");
  assert.equal(formatDevice(null), "Unknown device");
  assert.equal(formatDevice("  "), "Unknown device");
});

test("formatWeekParam names the week, with the year only when it differs", () => {
  assert.equal(formatWeekParam("2026-W09", 2026), "week 9");
  assert.equal(formatWeekParam("2026-W40", 2026), "week 40");
  assert.equal(formatWeekParam("2025-W52", 2026), "week 52, 2025");
  assert.equal(formatWeekParam("garbage", 2026), "garbage");
});

test("formatWatts shows whole watts with the unit", () => {
  assert.equal(formatWatts(249.6), "250 W");
  assert.equal(formatWatts(231), "231 W");
});
