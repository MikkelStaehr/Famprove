import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyKey,
  handleLimits,
  keyMove,
  moveHandle,
  parseSetClipRangeInput,
  rangeErrorLine,
  roundTenth,
  startRange,
  validateClipRange,
} from "../src/lib/video/clip-range.ts";
import { formatSeconds } from "../src/lib/video/cut-lines.ts";

const NONE = { clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null } as const;

test("start rule: user range, else clipped auto, else 0 / duration (AC 2)", () => {
  assert.deepEqual(startRange({ ...NONE, clipInS: 12.3, clipOutS: 48, autoInS: 1, autoOutS: 9, autoStatus: "clipped", durationS: 48 }), { inS: 12.3, outS: 48 });
  assert.deepEqual(startRange({ ...NONE, autoInS: 4.2, autoOutS: 39.6, autoStatus: "clipped", durationS: 45 }), { inS: 4.2, outS: 39.6 });
  assert.deepEqual(startRange({ ...NONE, autoInS: 4.2, autoOutS: 39.6, autoStatus: "low_confidence", durationS: 45 }), { inS: 0, outS: 45 });
  assert.deepEqual(startRange({ ...NONE, durationS: 43.04 }), { inS: 0, outS: 43 });
  assert.deepEqual(startRange({ ...NONE, clipInS: 10, clipOutS: 60, durationS: 40 }), { inS: 10, outS: 40 }, "clamped to the duration");
});

test("limits: Start 0 … out − 1, Slut in + 1 … duration (AC 3)", () => {
  const r = { inS: 12.3, outS: 48 };
  assert.deepEqual(handleLimits("in", r, 48), { min: 0, max: 47 });
  assert.deepEqual(handleLimits("out", r, 48), { min: 13.3, max: 48 });
});

test("moves never cross and keep ≥ 1,0 s; rounded to 0,1 (AC 3)", () => {
  const r = { inS: 12.3, outS: 48 };
  assert.deepEqual(moveHandle(r, "in", 47.95, 48), { inS: 47, outS: 48 }, "a drag past stops at the limit");
  assert.deepEqual(moveHandle(r, "out", 0, 48), { inS: 12.3, outS: 13.3 });
  assert.deepEqual(moveHandle(r, "in", -5, 48), { inS: 0, outS: 48 });
  assert.deepEqual(moveHandle(r, "out", 99, 48), { inS: 12.3, outS: 48 });
  assert.deepEqual(moveHandle(r, "in", 20.04, 48), { inS: 20, outS: 48 });
  assert.deepEqual(moveHandle(r, "in", Number.NaN, 48), r);
  assert.equal(roundTenth(0.1 + 0.2), 0.3);
});

test("keys: ←/→ 0,1 s, PageUp/Down and Shift 1 s, Home/End to the limit (AC 3)", () => {
  const r = { inS: 12.3, outS: 48 };
  const step = (key: string, shift = false, handle: "in" | "out" = "in") => {
    const m = keyMove(key, shift);
    assert.ok(m !== null, key);
    return applyKey(r, handle, m, 48);
  };
  let x = r;
  for (let i = 0; i < 3; i++) x = applyKey(x, "in", keyMove("ArrowRight", false)!, 48); // non-null: ArrowRight is a key
  assert.equal(x.inS, 12.6, "→×3 gives Start 12,6 s (shot 2)");
  assert.equal(step("ArrowLeft").inS, 12.2);
  assert.equal(step("ArrowRight", true).inS, 13.3);
  assert.equal(step("PageUp").inS, 13.3);
  assert.equal(step("PageDown").inS, 11.3);
  assert.equal(step("Home").inS, 0);
  assert.equal(step("End").inS, 47);
  assert.equal(step("Home", false, "out").outS, 13.3);
  assert.equal(step("End", false, "out").outS, 48);
  assert.equal(keyMove("Enter", false), null);
});

test("server validation table (AC 9)", () => {
  const ok = (a: unknown, b: unknown, d: number | null = 48) => validateClipRange(a, b, d);
  assert.deepEqual(ok(12.34, 48), { inS: 12.3, outS: 48 });
  assert.deepEqual(ok(null, null), { inS: null, outS: null });
  assert.deepEqual(ok(0, 1), { inS: 0, outS: 1 }, "exactly 1,0 s");
  assert.deepEqual(ok(2, 99, null), { inS: 2, outS: 99 }, "no duration: the shape check only");
  for (const [a, b] of [
    [5, 5],
    [6, 5],
    [5, 5.9],
    [-0.1, 4],
    [2, 48.1],
    [null, 4],
    [4, null],
    [undefined, 4],
    [Number.NaN, 4],
    [2, Number.POSITIVE_INFINITY],
    ["2", 4],
    [2, "4"],
  ] as const) {
    assert.equal(ok(a, b), null, `${String(a)}/${String(b)}`);
  }
  assert.equal(validateClipRange(1, 3, Number.NaN), null);
});

test("action input: a clip id and both keys", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(parseSetClipRangeInput({ id, inS: 1, outS: 3 }), { id, inS: 1, outS: 3 });
  assert.equal(parseSetClipRangeInput({ id: "x", inS: 1, outS: 3 }), null);
  assert.equal(parseSetClipRangeInput({ id, inS: 1 }), null);
  assert.equal(parseSetClipRangeInput([id]), null);
});

test("readout uses clip-cut's format, never a dot decimal (AC 5)", () => {
  assert.equal(formatSeconds(62.3), "1:02,3");
  assert.equal(formatSeconds(12.3), "12,3 s");
  assert.equal(rangeErrorLine("failed"), "Klippet blev ikke gemt. Tjek forbindelsen og prøv igen.");
  assert.match(rangeErrorLine("not_found"), /findes på serveren/);
  assert.equal(rangeErrorLine("range"), "Klippet kan ikke gemmes. Prøv at flytte håndtagene.");
});
