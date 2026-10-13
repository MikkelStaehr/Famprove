import assert from "node:assert/strict";
import { test } from "node:test";

import { devFixture, fixtureError, midsessionLog, STALE_AGE_MS, staleComputedAt } from "../src/lib/db/dev-fixture.ts";
import { PostgrestError } from "../src/lib/db/postgrest.ts";
import { freshness } from "../src/lib/dashboard-view.ts";

test("DEV_FIXTURE only switches under next dev, and only to known states", () => {
  for (const state of ["empty", "stale", "error", "band", "ef-few", "lsrpe", "midsession", "answers"] as const) {
    assert.equal(devFixture({ DEV_FIXTURE: state }, "development"), state);
    assert.equal(devFixture({ DEV_FIXTURE: state }, "production"), null);
    assert.equal(devFixture({ DEV_FIXTURE: state }, "test"), null);
    // The build inlines NODE_ENV; an env var claiming "development" changes nothing.
    assert.equal(devFixture({ NODE_ENV: "development", DEV_FIXTURE: state }, "production"), null);
  }
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => warnings.push(message);
  try {
    assert.equal(devFixture({ DEV_FIXTURE: "stal" }, "development"), null);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warnings, ["DEV_FIXTURE=stal ignored: expected empty, stale, error, band, ef-few, lsrpe, midsession, answers"]);
  assert.equal(devFixture({}, "development"), null);
});

test("the error fixture is an ordinary data error and the stale one is past the 26 h limit", () => {
  const error = fixtureError("daily_load");
  assert.ok(error instanceof PostgrestError);
  assert.equal(error.table, "daily_load");
  const now = new Date("2026-09-30T10:00:00Z");
  assert.equal(Date.parse(staleComputedAt(now)), now.getTime() - STALE_AGE_MS);
  assert.equal(freshness(staleComputedAt(now), now).kind, "stale");
});

test("DEV_FIXTURE=midsession: per session, 3 sets done 3 min apart, then one skipped", () => {
  const set = (session: number, sheetRow: number, setNo: number) => ({
    weekStart: "2026-10-12",
    session,
    block: "B",
    week: 3,
    sheetRow,
    setNo,
    name: "Squat",
    type: "SQUAT",
    setsText: "2",
    repsText: "3",
    prescribed: "RPE 6",
    loggedKg: null,
    bodyweight: false,
  });
  const now = new Date("2026-10-12T16:00:00Z");
  const log = midsessionLog([set(1, 26, 1), set(1, 25, 2), set(1, 25, 1), set(1, 27, 1), set(1, 28, 1), set(2, 77, 1)], "2026-10-12", now);
  const one = log.filter((l) => l.session === 1);
  assert.deepEqual(one.map((l) => [l.row, l.set, l.skipped]), [[25, 1, false], [25, 2, false], [26, 1, false], [27, 1, true]]);
  assert.equal(one[2]?.endedAt, new Date(now.getTime() - 102_000).toISOString()); // rest timer 1:42
  assert.deepEqual(log.filter((l) => l.session === 2).map((l) => l.row), [77]);
});
