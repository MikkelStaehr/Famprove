/**
 * Clips belong to the session and set they were recorded on (user, 2026-10-21): two sessions with
 * the same exercise in one week (squat on Monday's session 1 and Friday's session 3) never mix in a
 * Klip row, the run's set numbers restart per session, and "Gem alle fra i dag" takes today only.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { VideoClipRow } from "../src/lib/video/clips.ts";
import type { ClipIndexEntry } from "../src/lib/video/index-store.ts";
import { FIXTURE_NAMES } from "../src/lib/video/library-fixture.ts";
import { libraryRows, runSetNumbers, type SessionSetRow } from "../src/lib/video/library-view.ts";
import { todaysClips } from "../src/lib/video/save.ts";
import { setClipButtons } from "../src/lib/video/set-clips.ts";

const MONDAY = "2026-10-19";
const FRIDAY = "2026-10-23"; // same ISO week
const NEXT_MONDAY = "2026-10-26"; // the next week: the same sheet rows again

/** One clip on (date, session, row, set): its server row and its local file. */
function clip(n: number, date: string, session: number, row: number, set: number, hour: string): { row: VideoClipRow; local: ClipIndexEntry } {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const recordedAt = `${date}T${hour}:00+02:00`;
  return {
    row: {
      id, date, session, row, set, exerciseId: 1, variantId: null, recordedAt, durationS: 40, starred: false,
      clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null,
    },
    local: { id, setKey: { date, sessionNo: session, row, set }, ext: "mp4", recordedAt, durationS: 40, starred: false, starSynced: true, state: "done" },
  };
}

// Monday's session 1: squat on rows 25–27 (rows 25 and 26 one set each, row 27 two sets).
// Friday's session 3: squat again, on its own rows 61–62 (two sets each).
// Next Monday's session 1: the same rows 25–26 as this Monday (the sheet's rows repeat every week).
const CLIPS = [
  clip(1, MONDAY, 1, 25, 1, "10:31"),
  clip(2, MONDAY, 1, 26, 1, "10:34"),
  clip(3, MONDAY, 1, 27, 2, "10:42"),
  clip(4, FRIDAY, 3, 61, 1, "17:05"),
  clip(5, FRIDAY, 3, 62, 2, "17:15"),
  clip(6, NEXT_MONDAY, 1, 25, 1, "10:30"),
];
const set = (weekStart: string, session: number, row: number, s: number): SessionSetRow => ({ weekStart, session, block: "blok 12", row, set: s, name: "Squat", variantId: null });
const RUN_SETS = runSetNumbers([
  set(MONDAY, 1, 25, 1), set(MONDAY, 1, 26, 1), set(MONDAY, 1, 27, 1), set(MONDAY, 1, 27, 2),
  set(MONDAY, 3, 61, 1), set(MONDAY, 3, 61, 2), set(MONDAY, 3, 62, 1), set(MONDAY, 3, 62, 2),
  set(NEXT_MONDAY, 1, 25, 1), set(NEXT_MONDAY, 1, 26, 1),
]);
const ROWS = libraryRows(CLIPS.map((c) => c.local), CLIPS.map((c) => c.row), FIXTURE_NAMES, RUN_SETS);
const idsOf = (n: readonly number[]) => n.map((i) => CLIPS[i - 1]!.row.id);

test("a Klip row shows only its own session's clips: Monday's squat never shows Friday's, nor the other way", () => {
  assert.deepEqual(setClipButtons(ROWS, MONDAY, 1, [25, 26, 27]).map((b) => b.id), idsOf([1, 2, 3]));
  assert.deepEqual(setClipButtons(ROWS, FRIDAY, 3, [61, 62]).map((b) => b.id), idsOf([4, 5]));
  // Each session's rows with the other session's date or number: nothing.
  assert.equal(setClipButtons(ROWS, FRIDAY, 3, [25, 26, 27]).length, 0);
  assert.equal(setClipButtons(ROWS, MONDAY, 1, [61, 62]).length, 0);
  assert.equal(setClipButtons(ROWS, MONDAY, 3, [25, 26, 27, 61, 62]).length, 0, "the session number is checked, not only the rows");
  assert.equal(setClipButtons(ROWS, FRIDAY, 1, [25, 26, 27, 61, 62]).length, 0, "the date is checked, not only the session number");
});

test("the same sheet rows a week later are another session: the date keeps them apart", () => {
  assert.deepEqual(setClipButtons(ROWS, MONDAY, 1, [25]).map((b) => b.id), idsOf([1]));
  assert.deepEqual(setClipButtons(ROWS, NEXT_MONDAY, 1, [25]).map((b) => b.id), idsOf([6]));
});

test("each session numbers its own run from sæt 1: Friday's squat isn't sæt 5 after Monday's four", () => {
  assert.deepEqual(setClipButtons(ROWS, MONDAY, 1, [25, 26, 27]).map((b) => b.label), ["sæt 1", "sæt 2", "sæt 4"]);
  assert.deepEqual(setClipButtons(ROWS, FRIDAY, 3, [61, 62]).map((b) => b.label), ["sæt 1", "sæt 4"]);
  // One clip per set: no "(2)" from a clip of the other session on the same set number.
  for (const b of [...setClipButtons(ROWS, MONDAY, 1, [25, 26, 27]), ...setClipButtons(ROWS, FRIDAY, 3, [61, 62])]) assert.equal(b.nth, 1);
});

test("Gem alle fra i dag takes today's clips only: Friday sends Friday's, not Monday's or next week's", () => {
  assert.deepEqual(todaysClips(ROWS, FRIDAY).map((r) => r.id).toSorted(), idsOf([4, 5]).toSorted());
  assert.deepEqual(todaysClips(ROWS, MONDAY).map((r) => r.id).toSorted(), idsOf([1, 2, 3]).toSorted());
  assert.equal(todaysClips(ROWS, "2026-10-20").length, 0, "a day without a session sends nothing");
});

test("wiring: every Klip row is given its own session's date and number, and Gem alle the page's today", async () => {
  const { readFileSync } = await import("node:fs");
  const src = (p: string) => readFileSync(new URL(`../src/components/${p}`, import.meta.url), "utf8");
  const week = src("WeekCard.tsx");
  // The week card: each session's own day and number reach the exercise, and the exercise's Klip row.
  assert.match(week, /<Exercise key=\{exercise\.key\} date=\{date\} session=\{s\.session\} exercise=\{exercise\} \/>/);
  assert.match(week, /<SetClips date=\{date\} session=\{session\} rows=\{\[e\.row\]\} \/>/);
  // Træning's checklist: the open session's date and number.
  assert.match(src("SetChecklist.tsx"), /<SetClips date=\{date\} session=\{session\.session\} rows=/);
  // Gem alle fra i dag: the library's today, never a week.
  assert.match(src("ClipLibrary.tsx"), /todaysClips\(list, today\)/);
});
