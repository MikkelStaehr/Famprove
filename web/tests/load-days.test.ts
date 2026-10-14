import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

import {
  barDays,
  barTop,
  beforeLogSpan,
  curveAnchors,
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

test("curve y axis (fitness-round.md §1, user 2026-10-14): the axis starts at the data's whole-number floor; gridlines on 1/2/5/10/20… with ≤ 4 intervals", () => {
  assert.deepEqual(curveScale(11.2, 28.4), { lo: 11, hi: 30, step: 5, lines: [15, 20, 25, 30] });
  // 12U on 14 Oct: lowest 9,42 → the axis starts at 9, not 0 (no empty area under 10).
  assert.deepEqual(curveScale(9.42, 26.1), { lo: 9, hi: 30, step: 10, lines: [10, 20, 30] });
  assert.deepEqual(curveScale(10.91, 28), { lo: 10, hi: 30, step: 5, lines: [10, 15, 20, 25, 30] });
  assert.deepEqual(curveScale(17.2, 19.8), { lo: 17, hi: 20, step: 1, lines: [17, 18, 19, 20] });
  assert.deepEqual(curveScale(3, 160), { lo: 3, hi: 200, step: 50, lines: [50, 100, 150, 200] });
});

test("curve y axis: min = max gives one step; never below 0; Sæson from 0 stays at 0; non-finite throws", () => {
  assert.deepEqual(curveScale(20, 20), { lo: 20, hi: 21, step: 1, lines: [20, 21] });
  assert.deepEqual(curveScale(0, 0), { lo: 0, hi: 1, step: 1, lines: [0, 1] });
  assert.equal(curveScale(-2, 9).lo, 0);
  assert.equal(curveScale(0, 26).lo, 0);
  assert.throws(() => curveScale(Number.NaN, 10), RangeError);
  assert.throws(() => curveScale(0, Number.POSITIVE_INFINITY), RangeError);
});

test("1d the axis bottom is ≤ the minimum and less than 1 below it; ≤ 4 gridline intervals", () => {
  const cases: readonly (readonly [number, number])[] = [[11.2, 28.4], [0.4, 3.1], [18.7, 19.2], [5, 62], [44.9, 49.1], [99.5, 250], [20, 20], [9.42, 26.1]];
  for (const [min, max] of cases) {
    const s = curveScale(min, max);
    assert.ok(s.lo <= min && min - s.lo < 1, `bottom ${s.lo} for min ${min}`);
    assert.ok(s.hi >= max && s.hi - max <= s.step, `top ${s.hi} for max ${max}`);
    assert.ok(s.lines.every((v) => v >= s.lo && v <= s.hi && v % s.step === 0));
    assert.ok((s.hi - Math.floor(s.lo / s.step) * s.step) / s.step <= 4);
  }
});

// review-round.md §2: the curve's vertices are only the weekly anchors.
describe("curveAnchors", () => {
  const p = (date: string, kind: "actual" | "projected", band = false) => ({ date, kind, band });
  // Wed 2026-09-30 .. Wed 2026-10-14 measured; Thu 10-15 .. Tue 10-27 prognose (band from Tue 10-20).
  const days: string[] = [];
  for (let d = new Date("2026-09-30T00:00:00Z"); d <= new Date("2026-10-27T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  const points = days.map((d) => p(d, d <= "2026-10-14" ? "actual" : "projected", d >= "2026-10-20"));
  const a = curveAnchors(points, (x) => x.band);

  it("measured: the window's first day, each Sunday, the last measured day", () => {
    assert.deepEqual(a.measured.map((x) => x.date), ["2026-09-30", "2026-10-04", "2026-10-11", "2026-10-14"]);
  });

  it("prognose: the shared last measured day, each prognose Sunday, the last prognose day", () => {
    assert.deepEqual(a.prognose.map((x) => x.date), ["2026-10-14", "2026-10-18", "2026-10-25", "2026-10-27"]);
  });

  it("band: its first day, the Sundays and its last day", () => {
    assert.deepEqual(a.band.map((x) => x.date), ["2026-10-20", "2026-10-25", "2026-10-27"]);
  });

  it("no prognose: no prognose anchors, and a Sunday last day is not repeated", () => {
    const only = curveAnchors(points.filter((x) => x.date <= "2026-10-11"));
    assert.deepEqual(only.prognose, []);
    assert.deepEqual(only.measured.map((x) => x.date), ["2026-09-30", "2026-10-04", "2026-10-11"]);
  });
});
