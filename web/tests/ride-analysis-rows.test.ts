import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { EF_FEW_POINTS, fewEfPoints } from "../src/lib/db/dev-fixture.ts";
import { parseCyclingWeekRow, parseRideMetricsRow, parseRideViRow, RowError } from "../src/lib/db/rows.ts";

function fixture(name: string): unknown[] {
  const raw: unknown = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
  assert.ok(Array.isArray(raw) && raw.length > 0);
  return raw;
}

// Contract (CLAUDE.md): both fixtures are Python's own output, written by
// python/tests/test_contract_ride_analysis.py from the real producer (domain.ride_analysis +
// db.ride_metrics) on synthetic rides. Regenerate them there, never by hand.
test("contract: every ride_metrics row Python writes parses, edge cases included", () => {
  const rides = fixture("ride_metrics.json").map(parseRideMetricsRow);
  assert.deepEqual(
    [...new Set(rides.map((r) => r.exclusion ?? "in"))].sort(),
    ["hr_outlier", "in", "no_raw", "power_outlier", "too_short"],
  );
  assert.ok(rides.some((r) => r.deviceWatts === null && r.npW === null && !r.eftpOk));
  assert.ok(rides.some((r) => r.distanceM === null));
  assert.ok(rides.some((r) => r.type === "VirtualRide"));
  assert.ok(rides.some((r) => r.exclusion === "hr_outlier" && r.eftpOk && !r.efOk));
  assert.ok(rides.every((r) => r.efOk === (r.efTrend !== null)));
  assert.ok(rides.filter((r) => r.efGapBefore).length >= 2);
  assert.ok(rides.some((r) => r.eftpDeltaW !== null && r.eftpYearAgoDate !== null && r.eftpYearAgoW !== null));
  assert.ok(rides.some((r) => r.eftpOk && r.eftpDeltaW === null));
});

test("contract: every cycling_weeks row Python writes parses, weeks without rides included", () => {
  const weeks = fixture("cycling_weeks.json").map(parseCyclingWeekRow);
  assert.ok(weeks.some((w) => w.rides === 0 && w.movingS === 0 && w.load === 0));
  assert.ok(weeks.some((w) => w.excluded > 0 && w.excluded <= w.rides));
});

test("ride_metrics rejects an unknown exclusion and a numeric string", () => {
  const [first] = fixture("ride_metrics.json");
  assert.ok(typeof first === "object" && first !== null);
  assert.throws(() => parseRideMetricsRow({ ...first, exclusion: "junk" }), RowError);
  assert.throws(() => parseRideMetricsRow({ ...first, np_w: "180" }), RowError);
  assert.throws(() => parseRideMetricsRow({ ...first, device_watts: "true" }), RowError);
});

test("DEV_FIXTURE=ef-few keeps only the latest EF points", () => {
  const rides = fixture("ride_metrics.json").map(parseRideMetricsRow);
  const many = [...rides, ...rides.map((r) => ({ ...r, activityId: `${r.activityId}b`, date: "2027-01-01" }))];
  const few = fewEfPoints(many);
  const kept = few.filter((r) => r.efOk);
  assert.equal(kept.length, EF_FEW_POINTS);
  assert.deepEqual(kept.map((r) => r.activityId), many.filter((r) => r.efOk).slice(-EF_FEW_POINTS).map((r) => r.activityId));
  assert.ok(few.every((r) => r.efOk || (r.efTrend === null && !r.efGapBefore)));
  assert.equal(few.length, many.length);
});

test("contract: the week card's VI parses from every ride_metrics row Python writes", () => {
  const vi = fixture("ride_metrics.json").map(parseRideViRow);
  const by = new Map(vi.map((r) => [r.activityId, [r.vi, r.viWarning]]));
  assert.deepEqual(by.get("i110"), [1.17, true]); // Z2 by the ride's own name
  assert.deepEqual(by.get("i112"), [1.03, false]); // Z2 day, even pacing
  assert.deepEqual(by.get("i111"), [null, null]); // implausible ratio
  assert.deepEqual(by.get("i105"), [null, null]); // HR only
});

test("ride_metrics: a VI without its warning flag (or the other way round) is rejected", () => {
  assert.throws(() => parseRideViRow({ activity_id: "i1", vi: 1.2, vi_warning: null }), RowError);
  assert.throws(() => parseRideViRow({ activity_id: "i1", vi: null, vi_warning: false }), RowError);
});
