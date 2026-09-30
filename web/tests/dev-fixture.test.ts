import assert from "node:assert/strict";
import { test } from "node:test";

import { devFixture, fixtureError, STALE_AGE_MS, staleComputedAt } from "../src/lib/db/dev-fixture.ts";
import { PostgrestError } from "../src/lib/db/postgrest.ts";
import { freshness } from "../src/lib/dashboard-view.ts";

test("DEV_FIXTURE only switches under next dev, and only to known states", () => {
  for (const state of ["empty", "stale", "error"] as const) {
    assert.equal(devFixture({ NODE_ENV: "development", DEV_FIXTURE: state }), state);
    assert.equal(devFixture({ NODE_ENV: "production", DEV_FIXTURE: state }), null);
    assert.equal(devFixture({ NODE_ENV: "test", DEV_FIXTURE: state }), null);
  }
  assert.equal(devFixture({ NODE_ENV: "development", DEV_FIXTURE: "broken" }), null);
  assert.equal(devFixture({ NODE_ENV: "development" }), null);
});

test("the error fixture is an ordinary data error and the stale one is past the 26 h limit", () => {
  const error = fixtureError("daily_load");
  assert.ok(error instanceof PostgrestError);
  assert.equal(error.table, "daily_load");
  const now = new Date("2026-09-30T10:00:00Z");
  assert.equal(Date.parse(staleComputedAt(now)), now.getTime() - STALE_AGE_MS);
  assert.equal(freshness(staleComputedAt(now), now).kind, "stale");
});
