import assert from "node:assert/strict";
import { test } from "node:test";

import { LOAD_PLACE } from "../src/lib/load-grid.ts";

test("the /load grid keeps the phone order: hero and week in the rail, the chart in main", () => {
  const classes = (s: string): readonly string[] => s.split(/\s+/).sort();
  assert.deepEqual(classes(LOAD_PLACE.hero), ["lg:col-span-4", "lg:col-start-1", "lg:row-start-1"]);
  assert.deepEqual(classes(LOAD_PLACE.week), ["lg:col-span-4", "lg:col-start-1", "lg:row-start-2"]);
  assert.deepEqual(classes(LOAD_PLACE.chart), ["lg:col-span-8", "lg:col-start-5", "lg:row-span-2", "lg:row-start-1"]);
});
