import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { LOWER_BODY_WORDS } from "../src/lib/video/auto-clip.ts";

const PLANNED_SETS_PY = readFileSync(new URL("../../python/src/training_load/domain/planned_sets.py", import.meta.url), "utf8");

test("auto-clip's LOWER_BODY_WORDS match python/src/training_load/domain/planned_sets.py", () => {
  // LOWER_BODY_WORDS: Final = ( "SQUAT", "DEADLIFT", ... )
  const block = /^LOWER_BODY_WORDS: Final = \(([^)]*)\)/m.exec(PLANNED_SETS_PY);
  assert.ok(block !== null, "LOWER_BODY_WORDS not found in planned_sets.py");
  const words = [...(block[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map(([, w]) => w);
  assert.ok(words.length > 0);
  assert.deepEqual([...LOWER_BODY_WORDS].toSorted(), words.toSorted());
});
