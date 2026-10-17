import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanupPlan } from "../src/lib/video/cleanup.ts";
import type { VideoClipRow } from "../src/lib/video/clips.ts";
import type { ClipIndexEntry } from "../src/lib/video/index-store.ts";
import { clipsFixture, FIXTURE_NAMES } from "../src/lib/video/library-fixture.ts";
import { cleanupDue, cleanupLine, clipDay, clipDuration, libraryRows, pendingStars, unsyncedClips, usedBytes } from "../src/lib/video/library-view.ts";

const today = "2026-10-19";

test("fixture: 5 clips, 1 afbrudt, 1 fil mangler, newest first", () => {
  const f = clipsFixture(today);
  const rows = libraryRows(f.local, f.rows, FIXTURE_NAMES);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((r) => r.kind), ["clip", "clip", "afbrudt", "clip", "clip", "clip", "missing"]);
  assert.equal(rows[0]?.variant, "Pause Squat");
  assert.equal(rows[0]?.exercise, "Squat");
  assert.equal(rows[0]?.meta, "man. 19. okt · sæt 2 · 0:48");
  assert.equal(rows[0]?.sr, "Afspil Pause Squat, sæt 2, 19. oktober, 48 sekunder.");
  assert.equal(rows[2]?.meta, "sæt 2 · afbrudt · 0:31");
  assert.equal(rows[2]?.starred, false);
  assert.equal(rows[6]?.meta, "fil mangler");
});

test("no index (desktop): every row is read-only, på telefonen", () => {
  const f = clipsFixture(today);
  const rows = libraryRows(null, f.rows, FIXTURE_NAMES);
  assert.ok(rows.every((r) => r.kind === "remote" && r.meta.endsWith("på telefonen")));
});

test("rows unreadable: local clips still show", () => {
  const f = clipsFixture(today);
  const rows = libraryRows(f.local, null, FIXTURE_NAMES);
  assert.equal(rows.filter((r) => r.kind === "missing").length, 0);
  assert.equal(rows.length, 6);
});

test("the local ★ wins and an unconfirmed one is flagged and resent", () => {
  const f = clipsFixture(today);
  const local = f.local.map((e, i) => (i === 0 ? { ...e, starred: true, starSynced: false } : e));
  const row = libraryRows(local, f.rows, FIXTURE_NAMES).find((r) => r.id === local[0]?.id);
  assert.equal(row?.starred, true);
  assert.equal(row?.starUnsynced, true);
  assert.deepEqual(pendingStars(local).map((e) => e.id), [local[0]?.id]);
});

test("cleanup never deletes a locally starred clip 8 weeks old; deletes the unstarred one", () => {
  const old = "2026-08-01T10:00:00Z";
  const entry = (id: string, starred: boolean): ClipIndexEntry => ({
    id, setKey: { date: "2026-08-01", sessionNo: 1, row: 10, set: 1 }, ext: "mp4", recordedAt: old, durationS: 40, starred, starSynced: true, state: "done",
  });
  const row = (id: string): VideoClipRow => ({
    id, date: "2026-08-01", session: 1, row: 10, set: 1, exerciseId: 1, variantId: null, recordedAt: old, durationS: 40, starred: false, clipInS: null, clipOutS: null,
  });
  const plan = cleanupPlan([entry("a", true), entry("b", false)], [row("a"), row("b")], new Date(`${today}T08:00:00Z`));
  assert.deepEqual(plan.deleteLocal.map((e) => e.id), ["b"]);
});

test("helpers", () => {
  assert.equal(clipDay("2026-10-17"), "lør. 17. okt");
  assert.equal(clipDuration(48), "0:48");
  assert.equal(clipDuration(725), "12:05");
  assert.equal(cleanupDue(null, today), true);
  assert.equal(cleanupDue(today, today), false);
  assert.equal(cleanupDue("2026-10-18", today), true);
  assert.equal(cleanupLine(0), null);
  assert.equal(cleanupLine(3), "3 optagelser ældre end 8 uger blev slettet i dag.");
  assert.equal(usedBytes([1, null]), null);
  assert.equal(usedBytes([1, 2]), 3);
  const f = clipsFixture(today);
  assert.deepEqual(unsyncedClips([{ ...f.local[0]!, synced: false }]).length, 1);
});
