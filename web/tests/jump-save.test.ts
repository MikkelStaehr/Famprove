import assert from "node:assert/strict";
import { test } from "node:test";

import { jumpFailure } from "../src/lib/jump-save.ts";

test("a jump's failed save reverts while nothing was tapped after it, else the reload state", () => {
  assert.equal(jumpFailure(false), "revert");
  assert.equal(jumpFailure(true), "reload");
});
