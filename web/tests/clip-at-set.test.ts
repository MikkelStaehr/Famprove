import assert from "node:assert/strict";
import { test } from "node:test";

import type { ClipIndexEntry } from "../src/lib/video/index-store.ts";
import { clipsFixture, FIXTURE_NAMES, fixtureRunSets } from "../src/lib/video/library-fixture.ts";
import { libraryRows, shownName } from "../src/lib/video/library-view.ts";
import { clipButtonLabel, clipButtonName, setClipButtons } from "../src/lib/video/set-clips.ts";

const today = "2026-10-19";
const RUN = [25, 26, 27];

function rowsOf(local: readonly ClipIndexEntry[] | null) {
  const f = clipsFixture(today);
  return libraryRows(local, f.rows, FIXTURE_NAMES, fixtureRunSets(today));
}

test("the Klip row's numbers are the library's: sæt 1–4 over rows 25–27, row 27 holds sæt 3 and 4", () => {
  const f = clipsFixture(today);
  const rows = rowsOf(f.local);
  const run = setClipButtons(rows, today, 1, RUN);
  assert.deepEqual(run.map((b) => b.label), ["sæt 1", "sæt 2", "sæt 3", "sæt 4"]);
  for (const b of run) assert.equal(b.set, rows.find((r) => r.id === b.id)?.set);
  assert.deepEqual(setClipButtons(rows, today, 1, [25]).map((b) => b.label), ["sæt 1"]);
  assert.deepEqual(setClipButtons(rows, today, 1, [26]).map((b) => b.label), ["sæt 2"]);
  assert.deepEqual(setClipButtons(rows, today, 1, [27]).map((b) => b.label), ["sæt 3", "sæt 4"]);
  const name = shownName(rows.find((r) => r.id === run[0]?.id)!);
  assert.equal(run[1]?.name, `Afspil klip af ${name}, sæt 2`);
  // Another session or date has none of them.
  assert.equal(setClipButtons(rows, today, 2, RUN).length, 0);
  assert.equal(setClipButtons(rows, "2026-10-18", 1, RUN).length, 0);
});

test("two clips of one set: two buttons, oldest first, sæt n and sæt n (2)", () => {
  const f = clipsFixture(today);
  const last = f.local.find((e) => e.setKey.date === today && e.setKey.row === 27 && e.setKey.set === 2)!;
  const again: ClipIndexEntry = { ...last, id: "00000000-0000-4000-8000-0000000000aa", recordedAt: "2026-10-19T10:50:00.000Z" };
  const b = setClipButtons(rowsOf([...f.local, again]), today, 1, [27]);
  assert.deepEqual(b.map((x) => x.label), ["sæt 3", "sæt 4", "sæt 4 (2)"]);
  assert.equal(b[2]?.id, again.id);
  assert.match(b[2]?.name ?? "", /^Afspil klip 2 af .+, sæt 4$/);
});

test("a trimmed clip keeps its button and plays the cut; a pending delete is hidden; Fortryd brings it back", () => {
  const f = clipsFixture(today);
  const target = f.local.find((e) => e.setKey.date === today && e.setKey.row === 26)!;
  const trimmed: ClipIndexEntry = {
    ...target, fileName: `${target.id}-cut.mp4`, durationS: 12,
    pendingTrim: { deadline: "2026-10-19T11:00:00.000Z", originalFileName: `${target.id}.mp4`, originalDurationS: 43, newDurationS: 12 },
  };
  const rows = rowsOf(f.local.map((e) => (e.id === target.id ? trimmed : e)));
  assert.deepEqual(setClipButtons(rows, today, 1, [26]).map((b) => b.label), ["sæt 2"]);
  assert.equal(rows.find((r) => r.id === target.id)?.file, `${target.id}-cut.mp4`);
  const deleting: ClipIndexEntry = { ...target, pendingDelete: { deadline: "2026-10-19T11:00:00.000Z", batch: "b1" } };
  assert.equal(setClipButtons(rowsOf(f.local.map((e) => (e.id === target.id ? deleting : e))), today, 1, [26]).length, 0);
  assert.equal(setClipButtons(rowsOf(f.local), today, 1, [26]).length, 1);
});

test("a server clip without a file on this phone shows nothing (fil mangler, a remote browser)", () => {
  const f = clipsFixture(today);
  const missing = f.rows.find((r) => !f.local.some((e) => e.id === r.id))!;
  assert.equal(setClipButtons(rowsOf(f.local), missing.date, missing.session, [missing.row]).length, 0);
  const withoutToday = f.local.filter((e) => e.setKey.row !== 25);
  assert.deepEqual(setClipButtons(rowsOf(withoutToday), today, 1, RUN).map((b) => b.label), ["sæt 2", "sæt 3", "sæt 4"]);
  assert.equal(setClipButtons(rowsOf(null), today, 1, RUN).length, 0);
});

test("label and accessible name", () => {
  assert.equal(clipButtonLabel(2, 1), "sæt 2");
  assert.equal(clipButtonLabel(2, 2), "sæt 2 (2)");
  assert.equal(clipButtonName("Squat", 2, 1), "Afspil klip af Squat, sæt 2");
  assert.equal(clipButtonName("Squat", 2, 2), "Afspil klip 2 af Squat, sæt 2");
});
