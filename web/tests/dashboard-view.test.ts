import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blockSpans,
  buildDashboardView,
  currentWeek,
  freshness,
  STALE_AFTER_MS,
  zoneDisplay,
} from "../src/lib/dashboard-view.ts";
import { addDays } from "../src/lib/dates.ts";
import type { DailyLoadRow, DailyProjectionRow, DashboardData, WeeklyLoadRow } from "../src/lib/db/rows.ts";

function day(date: string, overrides: Partial<DailyLoadRow> = {}): DailyLoadRow {
  return {
    date,
    cyclingTss: 0,
    strengthTss: 0,
    totalTss: 0,
    ctl: 10,
    atl: 5,
    tsb: 5,
    ctlRamp7d: 1,
    formZone: "fresh",
    computedAt: "2026-09-28T03:05:00Z",
    ...overrides,
  };
}

const WEEK_40: WeeklyLoadRow = {
  weekStart: "2026-09-28",
  weekEnd: "2026-10-04",
  isoYear: 2026,
  isoWeek: 40,
  cyclingTss: 80,
  strengthTss: 12,
  totalTss: 92,
  days: 2,
};

test("freshness: fresh up to 26 h, stale after, unknown without computed_at", () => {
  const at = "2026-09-28T03:00:00Z";
  const edge = new Date(Date.parse(at) + STALE_AFTER_MS);
  assert.deepEqual(freshness(at, edge), { kind: "fresh", computedAt: at });
  assert.deepEqual(freshness(at, new Date(edge.getTime() + 1)), { kind: "stale", computedAt: at });
  assert.deepEqual(freshness(null, edge), { kind: "unknown" });
});

test("zoneDisplay maps Python keys and falls back to neutral for unknown ones", () => {
  assert.deepEqual(zoneDisplay("high_risk"), { key: "high_risk", label: "Høj risiko", tone: "negative" });
  assert.deepEqual(zoneDisplay("new_zone"), { key: "new_zone", label: "new_zone", tone: "neutral" });
  assert.deepEqual(zoneDisplay("toString"), { key: "toString", label: "toString", tone: "neutral" });
  assert.equal(zoneDisplay(null), null);
});

test("blockSpans clips to the series end and runs an ongoing block to it", () => {
  const spans = blockSpans(
    [
      { name: "blok 12", blockNo: 12, startDate: "2026-09-28", endDate: null, deloadStart: null },
      { name: "blok 11", blockNo: 11, startDate: "2026-08-10", endDate: "2026-09-13", deloadStart: "2026-09-07" },
      { name: "future", blockNo: 13, startDate: "2026-11-02", endDate: null, deloadStart: null },
    ],
    "2026-09-30",
  );
  assert.deepEqual(spans, [
    { name: "blok 11", blockNo: 11, start: "2026-08-10", end: "2026-09-13", deloadStart: "2026-09-07", ongoing: false },
    { name: "blok 12", blockNo: 12, start: "2026-09-28", end: "2026-09-30", deloadStart: null, ongoing: true },
  ]);
});

test("currentWeek follows the latest row's date, not the clock", () => {
  const data: DashboardData = {
    daily: [day("2026-09-27"), day("2026-09-28", { cyclingTss: 80, totalTss: 80 }), day("2026-09-29", { strengthTss: 12, totalTss: 12 })],
    blocks: [],
    weeks: [WEEK_40],
    projection: [],
  };
  const week = currentWeek(data, "2026-09-29");
  assert.ok(week);
  assert.equal(week.totalTss, 92); // weekly_load owns the sum
  assert.deepEqual(week.days.map((d) => d.date), ["2026-09-28", "2026-09-29"]);
  assert.equal(currentWeek(data, "2026-09-27"), null);
});

test("buildDashboardView: empty without rows, hero from the latest row otherwise", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  assert.deepEqual(buildDashboardView({ daily: [], blocks: [], weeks: [], projection: [] }, now), { kind: "empty" });
  const view = buildDashboardView(
    { daily: [day("2026-09-27", { tsb: -12 }), day("2026-09-28", { tsb: 10.8, formZone: "fresh" })], blocks: [], weeks: [WEEK_40], projection: [] },
    now,
  );
  assert.equal(view.kind, "ready");
  if (view.kind !== "ready") return;
  assert.equal(view.hero.tsb, 10.8);
  assert.equal(view.hero.zone?.label, "Frisk");
  assert.equal(view.freshness.kind, "fresh");
  assert.equal(view.chart.length, 2);
  assert.equal(view.week?.selected.isoWeek, 40);
  assert.equal(view.week?.param, "2026-W40");
});

function projected(date: string, ctl: number): DailyProjectionRow {
  return {
    date,
    cyclingTss: 25,
    strengthTss: 0,
    ctl,
    atl: ctl,
    tsb: 0,
    cyclingSource: "typical_week",
    rides: [],
    sessions: [
      {
        session: 2,
        tss: null,
        dayEstimated: true,
        reason: "no recent weeks to average",
        method: "recent",
        tssBand: null,
        recentWeeks: null,
        unscored: null,
      },
    ],
    strengthMethod: "recent",
    ctlBand: { low: ctl, high: ctl },
    atlBand: { low: ctl, high: ctl },
    tsbBand: { low: 0, high: 0 },
  };
}

test("chart: today ± 56 days, prognose only after the latest actual day, stale rows dropped", () => {
  const daily = Array.from({ length: 80 }, (_, i) => day(addDays("2026-07-12", i)));
  const last = daily.at(-1)?.date ?? "";
  const projection = [projected(last, 1), ...Array.from({ length: 60 }, (_, i) => projected(addDays(last, i + 1), 10))];
  const view = buildDashboardView({ daily, blocks: [], weeks: [], projection }, new Date(`${last}T12:00:00Z`));
  assert.equal(view.kind, "ready");
  if (view.kind !== "ready") return;
  const actual = view.chart.filter((p) => p.kind === "actual");
  const future = view.chart.filter((p) => p.kind === "projected");
  assert.equal(actual[0]?.date, addDays(last, -56));
  assert.equal(actual.at(-1)?.date, last);
  assert.equal(future[0]?.date, addDays(last, 1)); // the stale row dated `last` is not drawn
  assert.equal(future.at(-1)?.date, addDays(last, 56));
  assert.equal(future[0]?.estimate?.sessions[0]?.dayEstimated, true);
  assert.equal(view.lastActual, last);
  assert.equal(view.projection, "ready");
  const none = buildDashboardView({ daily, blocks: [], weeks: [], projection: [] }, new Date());
  const failed = buildDashboardView({ daily, blocks: [], weeks: [], projection: null }, new Date());
  assert.equal(none.kind === "ready" && none.projection, "none");
  assert.equal(failed.kind === "ready" && failed.projection, "error");
});
