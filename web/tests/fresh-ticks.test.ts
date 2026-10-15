import assert from "node:assert/strict";
import { test } from "node:test";

import { freshAfterTap, initialFresh, tickAnimates } from "../src/lib/fresh-ticks.ts";

test("a tick restored from the log on load or reload never gets the just-tapped flag", () => {
  const fresh = initialFresh(); // the set log may hold any number of done sets; fresh starts empty
  assert.equal(fresh.size, 0);
  for (const key of ["3#1", "3#2", "5#1"]) assert.equal(tickAnimates(fresh, key, "done"), false);
});

test("a done tap draws; undo and skip clear it; a re-tick draws again", () => {
  let fresh = freshAfterTap(initialFresh(), "done", "3#1");
  assert.equal(tickAnimates(fresh, "3#1", "done"), true);
  assert.equal(tickAnimates(fresh, "3#2", "done"), false, "only the tapped set");
  fresh = freshAfterTap(fresh, "undo", "3#1");
  assert.equal(tickAnimates(fresh, "3#1", "done"), false);
  fresh = freshAfterTap(fresh, "done", "3#1");
  fresh = freshAfterTap(fresh, "skip", "3#1");
  assert.equal(fresh.has("3#1"), false);
  fresh = freshAfterTap(fresh, "done", "3#1");
  assert.equal(tickAnimates(fresh, "3#1", "done"), true);
});

test("an open or skipped set never animates, and other taps leave the flags alone", () => {
  const fresh = freshAfterTap(initialFresh(), "done", "3#1");
  assert.equal(tickAnimates(fresh, "3#1", "open"), false);
  assert.equal(tickAnimates(fresh, "3#1", "skipped"), false);
  for (const kind of ["begin", "feel", "reps"] as const) assert.equal(freshAfterTap(fresh, kind, "3#1"), fresh);
  assert.equal(freshAfterTap(fresh, "done", "3#1"), fresh, "a second done is the same set");
});
