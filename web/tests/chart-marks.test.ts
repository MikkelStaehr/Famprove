import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  bracketGeometry,
  bracketLabel,
  eftpDot,
  eftpDotRadius,
  isCombDay,
  MARKS,
  maxLoadOf,
  monoLabelWidth,
  prognoseEvery,
} from "../src/lib/chart-marks.ts";

test("series: CTL a 1px solid line, ATL a 1px dashed line, TSB a 1px needle; prognose dots r 2 / 1.5 stroke 1; TSB prognose dashed 1 2", () => {
  assert.deepEqual([MARKS.ctl.width, MARKS.ctl.dash], [1, undefined]);
  assert.deepEqual([MARKS.atl.width, MARKS.atl.dash], [1, "4 3"]);
  assert.equal(MARKS.tsb.width, 1);
  assert.deepEqual(MARKS.ctl.prognose, { r: 2, stroke: 1 });
  assert.deepEqual(MARKS.atl.prognose, { r: 1.5, stroke: 1 });
  assert.equal(MARKS.tsb.prognoseDash, "1 2");
  assert.equal(prognoseEvery(false), 2);
  assert.equal(prognoseEvery(true), 1);
});

test("range comb every 4th day", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 8].map(isCombDay), [true, false, false, false, true, false, true]);
  assert.equal(isCombDay(-4), false);
});

test("eFTP dot: r = 1.5 + 4.5 √(load/max), clamped 1.5–6; null load = hollow ring r 3", () => {
  assert.equal(eftpDotRadius(100, 100), 6);
  assert.equal(eftpDotRadius(25, 100), 1.5 + 4.5 * 0.5);
  assert.equal(eftpDotRadius(0, 100), 1.5);
  assert.equal(eftpDotRadius(-5, 100), 1.5);
  assert.equal(eftpDotRadius(400, 100), 6); // above the max: clamped
  assert.equal(eftpDotRadius(50, 0), 1.5); // no ride has a load
  assert.deepEqual(eftpDot(null, 100), { r: 3, hollow: true });
  assert.deepEqual(eftpDot(100, 100), { r: 6, hollow: false });
  assert.equal(maxLoadOf([null, 40, 87, 12, null]), 87);
  assert.equal(maxLoadOf([null]), 0);
});

test("bracket: solid then dashed deload; deload clamped into the bracket", () => {
  const g = bracketGeometry(10, 110, 80);
  assert.deepEqual(g.solid, { x0: 10, x1: 80 });
  assert.deepEqual(g.deload, { x0: 80, x1: 110 });
  assert.deepEqual(g.ticks, [10, 110]);
  assert.equal(g.mid, 60);
  assert.equal(g.width, 100);

  assert.equal(bracketGeometry(10, 110, null).deload, null);
  assert.deepEqual(bracketGeometry(10, 110, null).solid, { x0: 10, x1: 110 });
  // Deload starts before the window: the whole visible bracket is dashed.
  const all = bracketGeometry(10, 110, -50);
  assert.equal(all.solid, null);
  assert.deepEqual(all.deload, { x0: 10, x1: 110 });
  // After the end: no dashed part. Reversed input is normalised.
  assert.equal(bracketGeometry(10, 110, 500).deload, null);
  assert.deepEqual(bracketGeometry(110, 10, null).ticks, [10, 110]);
});

test("bracket label: drawn only when it fits (mono 12 = 7.2px a character, 4px air each side)", () => {
  assert.equal(monoLabelWidth("Blok 12"), 7 * 7.2);
  assert.equal(bracketLabel(60, "Blok 12"), "Blok 12"); // 50.4 ≤ 52
  assert.equal(bracketLabel(50, "Blok 12"), null);
  assert.equal(bracketLabel(30, "B12"), "B12");
  assert.equal(bracketLabel(20, "B12"), null);
  assert.equal(MARKS.bracket.endTick, 6);
  assert.equal(MARKS.bracket.deloadDash, "3 2");
  assert.deepEqual(MARKS.bracket.strip, { load: 24, analyse: 18 });
});

test("today tick 2px in --today; 12 / 8 / 28 tall; the only today colour in the constant", () => {
  assert.equal(MARKS.todayTick.width, 2);
  assert.deepEqual(MARKS.todayTick.height, { chart: 12, analyse: 8, ruler: 28 });
  const src = readFileSync(new URL("../src/lib/chart-marks.ts", import.meta.url), "utf8");
  assert.equal(src.match(/var\(--today\)/g)?.length, 1);
  assert.ok(!/var\(--accent\)|var\(--chart-today\)|var\(--zone-|#[0-9a-fA-F]{3,6}\b/.test(src), "no accent, zone colour or hex");
});

test("shared marks and the zone ruler use no retired token", () => {
  for (const file of ["../src/components/ChartMarks.tsx", "../src/components/ZoneBar.tsx", "../src/components/ChartSeries.tsx", "../src/components/ChartReadout.tsx"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const retired of ["--zone-", "bg-zone", "slab", "block-fill", "prognose-band", "shadow-", "rounded-", "font-display", "italic"]) {
      assert.ok(!src.includes(retired), `${file} uses ${retired}`);
    }
  }
});
