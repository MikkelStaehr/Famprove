import assert from "node:assert/strict";
import { test } from "node:test";

import { capFacts, gapSeam, highestAt, nearestIndex, readoutText, restingReadout, tipLeft, viCell, xAtPointer } from "../src/lib/chart-readout.ts";

test("nearestIndex snaps to the nearest x, ties left, -1 when empty", () => {
  assert.equal(nearestIndex([], 5), -1);
  assert.equal(nearestIndex([1, 4, 10], 0), 0);
  assert.equal(nearestIndex([1, 4, 10], 6), 1);
  assert.equal(nearestIndex([1, 4, 10], 7), 1); // tie between 4 and 10 goes left
  assert.equal(nearestIndex([1, 4, 10], 8), 2);
  assert.equal(nearestIndex([1, 4, 10], 99), 2);
  assert.equal(nearestIndex([3, 3, 9], 3), 0); // two rides on one day: the first
});

test("xAtPointer maps the plot box to the domain and clamps", () => {
  const box = { left: 100, width: 248 };
  const inset = { left: 32, right: 16 };
  assert.equal(xAtPointer(132, box, inset, { lo: 0, hi: 200 }), 0);
  assert.equal(xAtPointer(232, box, inset, { lo: 0, hi: 200 }), 100);
  assert.equal(xAtPointer(10, box, inset, { lo: 0, hi: 200 }), 0);
  assert.equal(xAtPointer(999, box, inset, { lo: 0, hi: 200 }), 200);
});

test("tipLeft sits 12px right of the marker, flips left at the plot's right edge", () => {
  assert.equal(tipLeft(100, 150, 374), 112);
  assert.equal(tipLeft(300, 150, 374), 138); // 300 + 12 + 150 > 374: 300 - 12 - 150
  assert.equal(tipLeft(50, 300, 200), 0); // never past the left edge
});

test("restingReadout prefixes the latest point and is never blank", () => {
  const latest = { head: "ons. 30. sep.", cells: [{ key: "ctl", label: "Fitness", value: "45" }], facts: [] };
  assert.equal(restingReadout(latest, "x").head, "Seneste · ons. 30. sep.");
  assert.deepEqual(restingReadout(latest, "x").cells, latest.cells);
  const empty = restingReadout(null, "Tryk på grafen for at se en dag");
  assert.equal(empty.head, "Tryk på grafen for at se en dag");
  assert.equal(empty.muted, true);
});

test("viCell: decimal comma, flagged in warning, '–' kept when missing", () => {
  assert.deepEqual(viCell(1.08, false), { key: "vi", label: "VI", value: "1,08" });
  const flagged = viCell(1.2, true);
  assert.equal(flagged.value, "1,20");
  assert.equal(flagged.warning, true);
  assert.equal(flagged.sr, ", ujævn effekt på en Z2-dag");
  assert.equal(viCell(null, null).value, "–");
});

test("readoutText speaks a missing value as 'ikke registreret'", () => {
  const text = readoutText({ head: "tirs. 3. jun.", cells: [viCell(null, null), viCell(1.2, true)], facts: ["1:45 t"] });
  assert.equal(text, "tirs. 3. jun. VI ikke registreret, VI 1,20, ujævn effekt på en Z2-dag. 1:45 t");
});

test("readoutText: a short month keeps its own stop, 'maj' gets one", () => {
  assert.equal(readoutText({ head: "tirs. 13. okt.", cells: [], facts: ["1:45 t"] }), "tirs. 13. okt. 1:45 t");
  assert.equal(readoutText({ head: "fre. 8. maj", cells: [], facts: ["1:45 t"] }), "fre. 8. maj. 1:45 t");
});

test("capFacts keeps the row's line count: the rest joins the last line", () => {
  assert.deepEqual(capFacts(["a"], 1), ["a"]);
  assert.deepEqual(capFacts(["Cykel ≈ 40 TSS", "Styrke ≈ 60 TSS", "Spænd: fitness 44 til 49"], 1), [
    "Cykel ≈ 40 TSS · Styrke ≈ 60 TSS · Spænd: fitness 44 til 49",
  ]);
  assert.deepEqual(capFacts(["a", "b", "c", "d"], 3), ["a", "b", "c · d"]);
  assert.deepEqual(capFacts(["a"], 0), []);
});

test("highestAt: two rides on one day read the higher value; null never wins", () => {
  assert.equal(highestAt([1, 5, 5, 9], [10, 200, 212, 7], 1), 2);
  assert.equal(highestAt([1, 5, 5], [10, null, 180], 1), 2);
  assert.equal(highestAt([1, 5, 5], [10, 190, null], 1), 1);
  assert.equal(highestAt([1, 5], [10, 7], 0), 0);
});

test("gapSeam: a tap in a seam far from every ride stays there; near a ride it snaps", () => {
  const seams = [{ x0: 100, x1: 200 }];
  assert.equal(gapSeam(150, 90, seams), 0); // 60 days from the nearest ride, inside the seam
  assert.equal(gapSeam(105, 99, seams), -1); // 6 days: snaps to the ride
  assert.equal(gapSeam(250, 280, seams), -1); // far, but not in a seam: snaps
  assert.equal(gapSeam(150, undefined, seams), 0);
});
