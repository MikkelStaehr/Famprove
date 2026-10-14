import assert from "node:assert/strict";
import { test } from "node:test";

import { LOAD_PLACE } from "../src/lib/load-grid.ts";

test("the /load grid (review-round.md §1): form, tiles and week in col 1; curve cols 2–3 rows 1–3; row 4 grid | bars", () => {
  const classes = (s: string): readonly string[] => s.split(/\s+/).sort();
  assert.deepEqual(classes(LOAD_PLACE.form), ["lg:col-start-1", "lg:row-start-1"]);
  assert.deepEqual(classes(LOAD_PLACE.tiles), ["lg:col-start-1", "lg:row-start-2"]);
  assert.deepEqual(classes(LOAD_PLACE.week), ["lg:col-start-1", "lg:row-start-3"]);
  assert.deepEqual(classes(LOAD_PLACE.curve), ["lg:col-span-2", "lg:col-start-2", "lg:row-span-3", "lg:row-start-1"]);
  assert.deepEqual(classes(LOAD_PLACE.grid), ["lg:col-start-1", "lg:row-start-4"]);
  assert.deepEqual(classes(LOAD_PLACE.bars), ["lg:col-span-2", "lg:col-start-2", "lg:row-start-4"]);
});
