import assert from "node:assert/strict";
import { test } from "node:test";

import { dragLock, dragPosition, edgeStart, pageStyle, releaseTarget, STACK, tabIndex, tabTitle } from "../src/lib/tab-shell.ts";

test("a path belongs to its tab; Styrke is Analyse; anything else is Træning", () => {
  assert.deepEqual(["/train", "/load", "/analyse", "/analyse/styrke", "/load?x", "/"].map(tabIndex), [0, 1, 2, 2, 0, 0]);
  assert.equal(tabIndex("/loader"), 0); // a prefix that isn't a segment
});

test("motion-shell.md §1: the card stack at p = 0.5 (spec S5)", () => {
  const right = pageStyle(1, 0.5); // d = 0.5: sliding in on top
  assert.equal(right.transform, "translate3d(50%,0,0)");
  assert.equal(right.borderRadius, "var(--radius-stack) 0 0 var(--radius-stack)");
  assert.equal(right.boxShadow, STACK.shadow);
  assert.equal(right.visibility, "visible");
  const left = pageStyle(0, 0.5); // t = 0.5: sinking back
  assert.equal(left.transform, "translate3d(-4%,0,0) scale(0.96)");
  assert.equal(left.borderRadius, "calc(var(--radius-sink) * 0.5)"); // 13px
  assert.equal(left.scrim, 0.275);
  assert.equal(left.boxShadow, "none");
});

test("at rest: the settled page plain, the others hidden; z-order follows the index", () => {
  assert.deepEqual(pageStyle(1, 1), { transform: "translate3d(0%,0,0)", borderRadius: "0", boxShadow: "none", visibility: "visible", scrim: 0, zIndex: 2 });
  assert.equal(pageStyle(2, 1).visibility, "hidden");
  assert.equal(pageStyle(2, 1).boxShadow, "none"); // fully off: no shadow
  assert.equal(pageStyle(0, 1).visibility, "hidden");
  assert.equal(pageStyle(0, 1).scrim, 0.55);
});

test("drag lock: horizontal past 10 px and 1.3 x |dy|, a scroll past 10 px vertical", () => {
  assert.equal(dragLock(11, 8), "x");
  assert.equal(dragLock(11, 9), null); // 11 < 1.3 x 9
  assert.equal(dragLock(9, 0), null);
  assert.equal(dragLock(4, 11), "y");
  assert.equal(edgeStart(21, 390), true);
  assert.equal(edgeStart(22, 390), false);
  assert.equal(edgeStart(369, 390), true);
});

test("drag position: follows the finger, rubber band 0.3 past the ends (spec S4)", () => {
  assert.equal(dragPosition(1, -195, 390), 1.5);
  assert.equal(dragPosition(0, 100, 400), -0.075); // -0.25 x 0.3
  assert.equal(dragPosition(2, -100, 400), 2.075);
});

test("release: 22 % of the width or 0.45 px/ms changes page, else back; never past the ends (spec S2)", () => {
  assert.equal(releaseTarget(1, -0.3 * 390, 400, 390), 2); // 30 %, slow
  assert.equal(releaseTarget(1, -0.15 * 390, 400, 390), 1); // 15 %, slow: back
  assert.equal(releaseTarget(1, -0.15 * 390, 100, 390), 2); // 15 %, 0.585 px/ms: flick
  assert.equal(releaseTarget(1, 0.3 * 390, 400, 390), 0);
  assert.equal(releaseTarget(2, -300, 100, 390), 2);
  assert.equal(releaseTarget(0, 300, 100, 390), 0);
});

test("titles: the tab's label, Analyse · Styrke on its section", () => {
  assert.deepEqual(["/train", "/load", "/analyse", "/analyse/styrke"].map(tabTitle), ["Træning", "Belastning", "Analyse", "Analyse · Styrke"]);
});
