import assert from "node:assert/strict";
import { test } from "node:test";

import { supersetOffer, type SeamView } from "../src/lib/superset-view.ts";

// Two runs: Bench (row 10, sets 1–2), Pull-ups (row 11, sets 1–2). Only what supersetOffer reads.
const exercises = [
  { name: "Bench", variant: null, variantId: null, row: 10, sets: [{ row: 10, set: 1 }, { row: 10, set: 2 }] },
  { name: "Pull-ups", variant: null, variantId: null, row: 11, sets: [{ row: 11, set: 1 }, { row: 11, set: 2 }] },
] as unknown as Parameters<typeof supersetOffer>[0]; // ExerciseView carries many fields the rule never reads

const seam = (state: SeamView["state"]): SeamView => ({ rowA: 10, rowB: 11, state, nameA: "Bench", nameB: "Pull-ups", both: "Bench og Pull-ups", started: "Bench" });

test("shown off on A's warm-up before any tap", () => {
  const o = supersetOffer(exercises, [seam("available")], { row: 10, set: 0 });
  assert.equal(o?.label, "Superset med Pull-ups");
  assert.equal(o?.on, false);
  assert.equal(o?.line, null);
  assert.equal(o?.sentence(true), "Bench og Pull-ups tages som superset.");
});

test("shown on while paired, with the pair line; never on A1 (R1, decided 2026-10-17)", () => {
  const o = supersetOffer(exercises, [seam("paired")], { row: 10, set: 0 });
  assert.equal(o?.on, true);
  assert.equal(o?.line, "Superset med Pull-ups · den følger uden pause");
  assert.equal(o?.sentence(true), "Bench og Pull-ups tages som superset.");
  assert.equal(o?.sentence(false), "Bench og Pull-ups tages hver for sig.");
  assert.equal(supersetOffer(exercises, [seam("paired")], { row: 10, set: 1 }), null);
  assert.equal(supersetOffer(exercises, [seam("available")], { row: 10, set: 1 }), null);
});

test("suggested starts on with Som sidst", () => {
  const o = supersetOffer(exercises, [seam("suggested")], { row: 10, set: 0 });
  assert.equal(o?.on, true);
  assert.equal(o?.suggested, true);
});

test("hidden once a run has started (locked) or the seam is not offered", () => {
  assert.equal(supersetOffer(exercises, [seam("locked")], { row: 10, set: 2 }), null);
  assert.equal(supersetOffer(exercises, [seam("locked")], { row: 10, set: 1 }), null);
  assert.equal(supersetOffer(exercises, [seam("none")], { row: 10, set: 0 }), null);
});

test("hidden on any other set than A's warm-up", () => {
  assert.equal(supersetOffer(exercises, [seam("available")], { row: 10, set: 2 }), null);
  assert.equal(supersetOffer(exercises, [seam("available")], { row: 11, set: 0 }), null);
  assert.equal(supersetOffer(exercises, [], { row: 10, set: 0 }), null);
});
