import assert from "node:assert/strict";
import { test } from "node:test";

import { allLabel, isSheetEntry, lineParts, type LineInput, SHEET_HISTORY_STATE, sheetCloseVia, sheetShouldPush, sheetStaysOnPop } from "../src/lib/video/clip-line.ts";
import { PLAYER_HISTORY_STATE } from "../src/lib/video/library-view.ts";

const BASE: LineInput = { loading: false, error: false, clips: 9, save: 4, deletable: 2, pending: false, sheetOpen: false };

test("clips: row 1 space, switch, Alle klip; row 2 both actions; no status row", () => {
  const p = lineParts(BASE);
  assert.deepEqual(p.row1, ["space", "switch", "all"]);
  assert.deepEqual(p.row2, ["save", "delete"]);
  assert.equal(p.status, null);
  assert.equal(allLabel(9), "Alle klip · 9");
});

test("a count of 0 removes its action; both 0 removes row 2", () => {
  assert.deepEqual(lineParts({ ...BASE, save: 0 }).row2, ["delete"]);
  assert.deepEqual(lineParts({ ...BASE, deletable: 0 }).row2, ["save"]);
  assert.deepEqual(lineParts({ ...BASE, save: 0, deletable: 0 }).row2, []);
});

test("no clips: one row with the empty sentence and Alle klip, no count", () => {
  const p = lineParts({ ...BASE, clips: 0, save: 0, deletable: 0 });
  assert.deepEqual(p.row1, ["empty", "all"]);
  assert.deepEqual(p.row2, []);
  assert.equal(allLabel(0), "Alle klip");
});

test("pending Fortryd: the status row on the line, or in the sheet while it is open, never both", () => {
  assert.equal(lineParts({ ...BASE, pending: true }).status, "line");
  assert.equal(lineParts({ ...BASE, pending: true, sheetOpen: true }).status, "sheet");
  assert.equal(lineParts({ ...BASE, pending: false, sheetOpen: true }).status, null);
});

test("loading keeps row 1 at full height; a read error becomes row 2", () => {
  assert.deepEqual(lineParts({ ...BASE, loading: true }), { row1: ["space", "switch", "all"], row2: [], status: null });
  assert.deepEqual(lineParts({ ...BASE, error: true }).row2, ["error"]);
});

test("the sheet's history entry: pushed once, closed by back while on top, kept when back from the player lands on it", () => {
  const sheet = { [SHEET_HISTORY_STATE]: true };
  const player = { [PLAYER_HISTORY_STATE]: true };
  assert.equal(sheetShouldPush(null), true);
  assert.equal(sheetShouldPush(sheet), false);
  assert.equal(sheetCloseVia(sheet), "back");
  assert.equal(sheetCloseVia(null), "close");
  assert.equal(sheetCloseVia(player), "close");
  assert.equal(sheetStaysOnPop(sheet), true); // back closed the player over the sheet
  assert.equal(sheetStaysOnPop(null), false); // back closed the sheet
  assert.equal(isSheetEntry(player), false);
});
