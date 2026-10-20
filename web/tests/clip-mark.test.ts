import assert from "node:assert/strict";
import { test } from "node:test";

import {
  markIn,
  markRange,
  pendingLine,
  refusedLine,
  SAVING_LINE,
  savedLine,
  startLabel,
  startLine,
  UNDO_FAILED_LINE,
  undoInput,
  undoneLine,
} from "../src/lib/video/clip-mark.ts";
import { FIXTURE_FAILING_RANGE_ID, rangeErrorLine } from "../src/lib/video/clip-range.ts";
import { fixturePlayhead } from "../src/lib/video/library-fixture.ts";

const NONE = { clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null, durationS: 48 } as const;
const USER = { ...NONE, clipInS: 4.2, clipOutS: 39.6, autoInS: 1, autoOutS: 9, autoStatus: "clipped" } as const;
const AUTO = { ...NONE, autoInS: 4.2, autoOutS: 39.6, autoStatus: "clipped" } as const;

test("in rule: pending Start, else the user's in, else the clipped auto in, else 0 (AC 4)", () => {
  assert.equal(markIn(USER, 12.34), 12.3, "pending wins, rounded");
  assert.equal(markIn(USER, null), 4.2, "user's in");
  assert.equal(markIn({ ...AUTO, clipInS: null }, null), 4.2, "clipped auto in");
  assert.equal(markIn({ ...AUTO, autoStatus: "low_confidence" }, null), 0, "low_confidence auto is no in");
  assert.equal(markIn(NONE, null), 0);
});

test("Slut: out = now rounded to 0.1 and capped at the duration (AC 4)", () => {
  assert.deepEqual(markRange(NONE, 12.3, 48.04), { kind: "ok", range: { inS: 12.3, outS: 48 } });
  assert.deepEqual(markRange(NONE, 12.3, 61), { kind: "ok", range: { inS: 12.3, outS: 48 } }, "capped");
  assert.deepEqual(markRange({ ...NONE, durationS: 41 }, 12.3, 48), { kind: "ok", range: { inS: 12.3, outS: 41 } });
  assert.deepEqual(markRange(USER, null, 20.06), { kind: "ok", range: { inS: 4.2, outS: 20.1 } });
  assert.deepEqual(markRange(AUTO, null, 30), { kind: "ok", range: { inS: 4.2, outS: 30 } });
  assert.deepEqual(markRange(NONE, null, 1), { kind: "ok", range: { inS: 0, outS: 1 } }, "exactly 1.0 s is allowed");
});

test("refused: out ≤ in, shorter than 1.0 s, or no playhead (AC 5)", () => {
  assert.deepEqual(markRange(AUTO, null, 4.8), { kind: "refused", inS: 4.2 }, "shot 5: auto in 4.2, out 4.8");
  assert.deepEqual(markRange(NONE, 12.3, 12.3), { kind: "refused", inS: 12.3 });
  assert.deepEqual(markRange(NONE, 12.3, 5), { kind: "refused", inS: 12.3 });
  assert.deepEqual(markRange(NONE, 12.3, 13.25), { kind: "ok", range: { inS: 12.3, outS: 13.3 } }, "13.25 rounds to 13.3: exactly 1.0 s");
  assert.deepEqual(markRange(NONE, 12.3, 13.24), { kind: "refused", inS: 12.3 }, "0.9 s");
  assert.deepEqual(markRange(NONE, 47.5, 60), { kind: "refused", inS: 47.5 }, "capped out leaves 0.5 s");
  assert.deepEqual(markRange(NONE, 12.3, Number.NaN), { kind: "refused", inS: 12.3 });
});

test("Fortryd's input: the stored range before the mark, or null/null (AC 7)", () => {
  assert.deepEqual(undoInput(USER), { inS: 4.2, outS: 39.6 });
  assert.deepEqual(undoInput(AUTO), { inS: null, outS: null }, "an auto range is not stored by the user");
  assert.deepEqual(undoInput({ clipInS: 3, clipOutS: null }), { inS: null, outS: null });
});

test("lines (§2, §3)", () => {
  assert.equal(startLabel(null), "Start her");
  assert.equal(startLabel(12.3), "Start 12,3 s");
  assert.equal(pendingLine(12.3), "Start 12,3 s · tryk Slut her");
  assert.equal(startLine(12.3), "Start sat ved 12,3 s.");
  assert.equal(SAVING_LINE, "Gemmer …");
  assert.equal(refusedLine(12.3), "Slut skal ligge mindst 1,0 s efter start (12,3 s). Lad videoen spille videre, og tryk igen.");
  assert.equal(savedLine({ inS: 12.3, outS: 48 }), "Klip gemt · 12,3–48,0 s.");
  assert.equal(undoneLine({ inS: 4.2, outS: 39.6 }), "Fortrudt · klippet er igen 4,2–39,6 s.");
  assert.equal(undoneLine({ inS: null, outS: null }), "Fortrudt · dit klip er fjernet.");
  assert.equal(UNDO_FAILED_LINE, "Fortryd blev ikke gemt. Tjek forbindelsen og prøv igen.");
  assert.equal(rangeErrorLine("network"), "Klippet blev ikke gemt. Tjek forbindelsen og prøv igen.", "the failed line is clip-handles'");
});

test("fixture playhead (§4): clips 1 and the failing one 12.3 → 48.0, clip 2 4.8", () => {
  const one = "00000000-0000-4000-8000-000000000001";
  assert.equal(fixturePlayhead(one, false), 12.3);
  assert.equal(fixturePlayhead(one, true), 48);
  assert.equal(fixturePlayhead(FIXTURE_FAILING_RANGE_ID, true), 48);
  assert.equal(fixturePlayhead("00000000-0000-4000-8000-000000000002", false), 4.8);
});
