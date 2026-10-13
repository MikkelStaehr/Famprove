import assert from "node:assert/strict";
import { test } from "node:test";

import { dotField, dotRow, drawingReps, FIELD_DOTS, showsKgReminder, signature } from "../src/lib/fokus-marks.ts";
import { prescribedCell, rangeFigure } from "../src/lib/fokus-view.ts";
import { type LoggedSet, setKey, type SetRef } from "../src/lib/set-taps.ts";

const T0 = Date.parse("2026-10-13T16:00:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const done = (row: number, set: number, endS: number, extra: Partial<LoggedSet> = {}): LoggedSet => ({
  row, set, startedAt: at(endS - 60), endedAt: at(endS), skipped: false, updatedAt: at(endS), ...extra,
});
const skip = (row: number, set: number, s: number): LoggedSet => ({ row, set, startedAt: null, endedAt: null, skipped: true, updatedAt: at(s) });
const logOf = (rows: LoggedSet[]) => new Map(rows.map((l) => [setKey(l), l]));

const EX = [
  { name: "Squat", row: 4, repsText: "5", kg: 140 },
  { name: "Leg curl", row: 6, repsText: "8 - 12", kg: null },
];
// Squat warm-up + 3 sets, Leg curl warm-up + 2 sets.
const ORDER: SetRef[] = [
  { row: 4, set: 0 }, { row: 4, set: 1 }, { row: 4, set: 2 }, { row: 4, set: 3 },
  { row: 6, set: 0 }, { row: 6, set: 1 }, { row: 6, set: 2 },
];

test("dot field: filled = floor(elapsed / scale × 360), column-major, ticks and marks per §3.1", () => {
  const scale = 1.2 * 300; // 6 min: one dot = 1 s
  const zero = dotField(0, scale, 180, 300);
  assert.equal(zero.filled, 0);
  assert.equal(zero.tickX, 0);
  assert.ok(zero.dots.every((d) => d.kind === "empty"));
  assert.equal(zero.dots.length, FIELD_DOTS);
  const f = dotField(220, scale, 180, 300);
  assert.equal(f.filled, 220);
  assert.deepEqual([f.minX, f.maxX], [180, 300]);
  assert.equal(f.tickX, 220);
  // Column-major, top to bottom: dot 7 is column 1, row 1.
  assert.deepEqual(f.dots[7], { cx: 9, cy: 21, kind: "filled" });
  assert.equal(f.dots[220].kind, "empty");
  // Past MAX: the filled dots from 300 on are rings; past the scale everything is filled, the tick clamped.
  const over = dotField(330, scale, 180, 300);
  assert.equal(over.dots[299].kind, "filled");
  assert.equal(over.dots[300].kind, "over");
  assert.equal(over.dots[330].kind, "empty");
  const past = dotField(9999, scale, 180, 300);
  assert.equal(past.filled, 360);
  assert.equal(past.tickX, 358);
  // Warm-up: 10 min, no MIN/MAX, no rings.
  const warm = dotField(300, 600, null, null);
  assert.equal(warm.filled, 180);
  assert.deepEqual([warm.minX, warm.maxX], [null, null]);
  assert.ok(!warm.dots.some((d) => d.kind === "over"));
  // Deterministic.
  assert.deepEqual(dotField(220, scale, 180, 300), f);
});

test("dot row: one dot per tapped set, rings for skips, warm-ups never, grouped per exercise", () => {
  const empty = dotRow(EX, ORDER, logOf([]));
  assert.deepEqual(empty.groups, []);
  assert.equal(empty.sentence, "I dag: 0 sæt udført, 0 sprunget over.");
  const row = dotRow(EX, ORDER, logOf([done(4, 0, 100), done(4, 1, 200), skip(4, 2, 250), done(4, 3, 400), done(6, 0, 500), done(6, 1, 600)]));
  assert.deepEqual(row.groups.map((g) => g.dots.map((d) => d.kind)), [["done", "skipped", "done"], ["done"]]);
  assert.deepEqual(row.groups[0].dots.map((d) => d.cx), [4, 14, 24]);
  assert.equal(row.groups[0].width, 28);
  assert.equal(row.sentence, "I dag: 3 sæt udført, 1 sprunget over.");
});

test("signature: a bar per done set, hollow exactly where kg is unknown, warm-ups as gaps, deterministic", () => {
  const log = logOf([
    done(4, 0, 0),
    done(4, 1, 180, { feltRpe: 0 }),
    done(4, 2, 1000, { feltRpe: 1 }), // > 6 min: the gap is capped
    skip(4, 3, 1010),
    done(6, 0, 1100),
    done(6, 1, 1190, { feltRpe: -1, repsDone: 12 }),
    done(6, 2, 1280), // unrated, no reps_done: the range's midpoint (10)
  ]);
  const sig = signature(EX, ORDER, log);
  assert.equal(sig.bars.length, 4);
  assert.deepEqual(sig.bars.map((b) => b.hollow), [false, false, true, true]);
  assert.equal(sig.stubs.length, 1);
  assert.deepEqual(sig.bars.map((b) => b.marker), ["dash", "square", "ring", null]);
  assert.deepEqual(sig.bars.map((b) => b.muted), [false, false, true, false]);
  // Solid: reps × kg over the max (both 5 × 140) = full; hollow: reps over the max reps (12).
  assert.equal(sig.bars[0].h, 96);
  assert.equal(sig.bars[2].h, 96);
  assert.equal(sig.bars[3].h, Math.round((8 + (88 * 10) / 12) * 100) / 100);
  // x: gaps 2 (first), 2+14·180/360 = 9, 16 (capped), stub 2, warm 2+14·90/360, ...; scaled by min(360/total, 2) = 2.
  assert.equal(sig.bars[0].x, 2 * (2 + 9));
  assert.equal(sig.bars[0].w, 8);
  assert.equal(
    sig.sentence,
    "Sessionens forløb, et sæt pr. søjle: 4 udført, 1 sprunget over. Kg kendt for 2 sæt; resten er tegnet efter reps. 1 lettere, 1 som ventet, 1 hårdere, 1 uden vurdering.",
  );
  assert.equal(JSON.stringify(signature(EX, ORDER, log)), JSON.stringify(sig));
  // No sets tapped: nothing drawn.
  const none = signature(EX, ORDER, logOf([]));
  assert.deepEqual([none.bars.length, none.stubs.length], [0, 0]);
  // Unknown kg is never drawn as 0 kg: a 0 or null kg row is hollow, by reps.
  const zeroKg = signature([{ ...EX[0], kg: 0 }], ORDER.slice(0, 2), logOf([done(4, 1, 10)]));
  assert.deepEqual(zeroKg.bars.map((b) => [b.hollow, b.h]), [[true, 96]]);
});

test("signature legend: the kg reminder shows only when a bar is hollow", () => {
  const log = logOf([done(4, 1, 0), done(4, 2, 180), done(6, 1, 360)]);
  assert.equal(showsKgReminder(signature(EX, ORDER, log)), true); // row 6 has no sheet kg: hollow
  const allKg = signature(EX.map((e) => ({ ...e, kg: 100 })), ORDER, log);
  assert.equal(showsKgReminder(allKg), false); // every set has kg in the sheet: nothing to log
  assert.equal(showsKgReminder(signature(EX, ORDER, logOf([skip(4, 1, 0)]))), false); // skipped only: no bars
});

test("signature: kg in the sheet with unreadable reps (AMRAP) is solid at the minimum, and asks for no kg", () => {
  const amrap = [{ name: "Squat", row: 4, repsText: "AMRAP", kg: 140 }];
  const sig = signature(amrap, ORDER.slice(0, 2), logOf([done(4, 1, 10)]));
  assert.deepEqual(sig.bars.map((b) => [b.hollow, b.h]), [[false, 8]]);
  assert.equal(showsKgReminder(sig), false);
  assert.match(sig.sentence, /Kg kendt for 1 sæt/);
});

test("dot field: a non-positive scale draws an empty field, never NaN", () => {
  const field = dotField(90, 0, null, null);
  assert.ok(field.dots.every((d) => d.kind === "empty" && Number.isFinite(d.cx) && Number.isFinite(d.cy)));
});

test("drawing reps: reps_done, else the prescription (a range's midpoint), else null", () => {
  assert.equal(drawingReps(EX[1], done(6, 1, 0, { repsDone: 11 })), 11);
  assert.equal(drawingReps(EX[1], done(6, 1, 0)), 10);
  assert.equal(drawingReps(EX[0], undefined), 5);
  assert.equal(drawingReps({ name: "X", row: 1, repsText: "AMRAP" }, undefined), null);
});

test("set view value row: ranges as one figure, RPE / PROCENT captions", () => {
  assert.equal(rangeFigure("8 - 12"), "8–12");
  assert.equal(rangeFigure("-12.5"), "-12.5");
  assert.deepEqual(prescribedCell("RPE 7 - 8"), { caption: "RPE", value: "7–8", unit: null });
  assert.deepEqual(prescribedCell("-12.5%"), { caption: "Procent", value: "-12.5", unit: "%" });
  assert.equal(prescribedCell(null), null);
  assert.deepEqual(prescribedCell("tung"), { caption: null, value: "tung", unit: null });
});

test("signature: a clock skew (an end before the previous end) or a missing end is a 2-unit gap, never negative", () => {
  const log = logOf([done(4, 1, 500), done(4, 2, 100), done(4, 3, 280)]);
  const sig = signature(EX, ORDER, log);
  // Gaps 2 (first), 2 (Δ < 0), 2 + 14·180/360 = 9; total 25 → scale 2.
  assert.deepEqual(sig.bars.map((b) => b.x), [4, 16, 42]);
  const noEnd = signature(EX, ORDER, logOf([done(4, 1, 0, { endedAt: null }), done(4, 2, 180)]));
  assert.ok([...noEnd.bars.map((b) => b.x), ...noEnd.bars.map((b) => b.h)].every(Number.isFinite));
});

test("all skipped: stubs and rings only, finite geometry, counts in the sentences", () => {
  const log = logOf([skip(4, 1, 0), skip(4, 2, 10), skip(4, 3, 20)]);
  const sig = signature(EX, ORDER, log);
  assert.equal(sig.bars.length, 0);
  assert.deepEqual(sig.stubs.map((s) => s.x), [4, 16, 28]);
  assert.equal(showsKgReminder(sig), false);
  assert.equal(
    sig.sentence,
    "Sessionens forløb, et sæt pr. søjle: 0 udført, 3 sprunget over. Kg kendt for 0 sæt; resten er tegnet efter reps. 0 lettere, 0 som ventet, 0 hårdere, 0 uden vurdering.",
  );
  const row = dotRow(EX, ORDER, log);
  assert.deepEqual(row.groups.map((g) => g.dots.map((d) => d.kind)), [["skipped", "skipped", "skipped"]]);
  assert.equal(row.sentence, "I dag: 0 sæt udført, 3 sprunget over.");
});
