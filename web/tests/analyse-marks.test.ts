import assert from "node:assert/strict";
import { test } from "node:test";

import { AMARKS, dashGradient, hatchGradient, isDeloadWeek, monoWidth, tickAnchor, ticksClearOfToday, TODAY_CLEAR } from "../src/lib/analyse-marks.ts";

// A 1000px plot over days 0..1000 (1px a day), today at 999.5 (hi = today + 0.5, as analyse-view).
// `I DAG` = 5 × 6.6 = 33px, end-anchored 4px left of the line: its left edge at 962.5, so a label
// must end at or before 954.5 or start at or after 1008.25.
const G = { lo: 0, hi: 1000, today: 999.5, width: 1000 };

test("x labels: a label reaching within 8px of the I DAG caption is skipped, the rest kept", () => {
  const ticks = [
    { x: 0, label: "jan." },
    { x: 500, label: "jul." },
    { x: 940, label: "okt." }, // centred: 926.8–953.2, ends 9.3px before the caption → kept
    { x: 945, label: "nov." }, // centred: 931.8–958.2, within 8px of 962.5 → skipped
  ];
  assert.deepEqual(
    ticksClearOfToday(ticks, G).map((t) => t.label),
    ["jan.", "jul.", "okt."],
  );
});

test("x labels: an end-anchored label next to today is skipped; no today keeps every label", () => {
  const ticks = [
    { x: 0, label: "jan." },
    { x: 990, label: "okt." }, // hi − x < 30 → end-anchored: 963.6–990, on the caption
  ];
  assert.equal(tickAnchor(1, 990, G.hi), "end");
  assert.deepEqual(ticksClearOfToday(ticks, G).map((t) => t.label), ["jan."]);
  assert.deepEqual(ticksClearOfToday(ticks, { ...G, today: null }).map((t) => t.label), ["jan.", "okt."]);
});

test("x labels: a label right of the today line keeps its place; anchors use the full list", () => {
  // Styrke-style domain where today is mid-plot: a label well right of the line is kept.
  const g = { lo: 0, hi: 400, today: 200, width: 400 };
  const ticks = [
    { x: 0, label: "jan." },
    { x: 190, label: "jul." }, // centred 176.8–203.2: on the caption and line → skipped
    { x: 240, label: "aug." }, // centred 226.8–253.2: starts past 200 + 0.75 + 8 → kept
  ];
  assert.deepEqual(ticksClearOfToday(ticks, g).map((t) => t.label), ["jan.", "aug."]);
  assert.equal(tickAnchor(0, 0, 400), "start");
  assert.equal(tickAnchor(1, 240, 400), "middle");
  assert.equal(monoWidth("I DAG"), 33);
  assert.equal(TODAY_CLEAR, 8);
});

test("deload weeks: a slot whose centre lies in a block's deload part", () => {
  const blocks = [
    { x0: 0, x1: 28, deloadX0: 21 },
    { x0: 35, x1: 63, deloadX0: null },
  ];
  assert.equal(isDeloadWeek({ x0: 21, x1: 28 }, blocks), true);
  assert.equal(isDeloadWeek({ x0: 14, x1: 21 }, blocks), false);
  // A gap week between blocks and a block without a deload are not deload.
  assert.equal(isDeloadWeek({ x0: 28, x1: 35 }, blocks), false);
  assert.equal(isDeloadWeek({ x0: 56, x1: 63 }, blocks), false);
  assert.equal(isDeloadWeek({ x0: 0, x1: 7 }, []), false);
});

test("gradients use the given tokens and pitch, never hex", () => {
  assert.equal(dashGradient("to right", "var(--axis)", 2, 3), "repeating-linear-gradient(to right, var(--axis) 0 2px, transparent 2px 5px)");
  assert.match(hatchGradient(), /^repeating-linear-gradient\(135deg, var\(--shade-2\) 0 1px, var\(--card\) 1px 4px\)$/);
  assert.doesNotMatch(JSON.stringify(AMARKS), /#[0-9a-f]{3,6}/i);
});

test("today is the only --today mark", () => {
  const uses = JSON.stringify(AMARKS).match(/--today/g) ?? [];
  assert.equal(uses.length, 1);
});

test("a one-day domain keeps every tick (no division by zero)", () => {
  const ticks = [{ x: 5, label: "jan." }];
  assert.deepEqual(ticksClearOfToday(ticks, { lo: 5, hi: 5, today: 5, width: 300 }).map((t) => t.label), ["jan."]);
});
