import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { cleanupPlan } from "../src/lib/video/cleanup.ts";
import type { VideoClipRow } from "../src/lib/video/clips.ts";
import type { ClipIndexEntry } from "../src/lib/video/index-store.ts";
import { clipsFixture, FIXTURE_NAMES, fixtureRunSets } from "../src/lib/video/library-fixture.ts";
import { runPositions } from "../src/lib/training-view.ts";
import {
  cleanupDue,
  cleanupLine,
  clipDay,
  clipDuration,
  libraryRows,
  MISSING_DELETE_FAILED,
  runSetNumbers,
  pendingStars,
  playerCloseVia,
  playerShouldPush,
  unsyncedClips,
  usedBytes,
} from "../src/lib/video/library-view.ts";

const today = "2026-10-19";

test("fixture: 7 clips, 1 afbrudt, 1 fil mangler, newest first; today's run numbered 4, 3, 2, 1", () => {
  const f = clipsFixture(today);
  const rows = libraryRows(f.local, f.rows, FIXTURE_NAMES, fixtureRunSets(today));
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.map((r) => r.kind), ["clip", "clip", "clip", "clip", "afbrudt", "clip", "clip", "clip", "missing"]);
  assert.equal(rows[0]?.variant, "Pause Squat");
  assert.equal(rows[0]?.exercise, "Squat");
  assert.equal(rows[0]?.meta, "man. 19. okt · sæt 4 · 0:48");
  assert.equal(rows[0]?.sr, "Afspil Pause Squat, sæt 4, 19. oktober, 48 sekunder.");
  assert.deepEqual(rows.slice(0, 4).map((r) => r.set), [4, 3, 2, 1]);
  assert.equal(rows[4]?.meta, "sæt 2 · afbrudt · 0:31"); // no rows for its week: set_no
  assert.equal(rows[4]?.starred, false);
  assert.equal(rows[8]?.meta, "fil mangler");
});

test("19 Oct shape (rows 25: 1 set, 26: 1, 27: 2): the card's numbers equal Fokus's Sæt n; an old week keeps set_no", () => {
  const sets = [[25, 1], [26, 1], [27, 1], [27, 2], [28, 1]] as const;
  const named = (row: number) => (row === 28 ? "Bench Press" : "Squat");
  const runSets = runSetNumbers(sets.map(([row, set]) => ({ weekStart: today, session: 1, block: "Program - blok 12", row, set, name: named(row), variantId: null })));
  // Fokus's numbers: runPositions over the session's rows, as fokusView reads them.
  const fokus = runPositions([25, 26, 27, 28].map((row) => ({ name: named(row), variantId: null, sets: sets.filter(([r]) => r === row).map(([r, s]) => ({ row: r, set: s })) })));
  const clip = (i: number, row: number, set: number, date = today): VideoClipRow => ({
    id: `c${i}`, date, session: 1, row, set, exerciseId: 1, variantId: null, recordedAt: `${date}T17:${40 + i}:00Z`, durationS: 40, starred: false, clipInS: null, clipOutS: null,
  });
  const server = [clip(1, 25, 1), clip(2, 26, 1), clip(3, 27, 1), clip(4, 27, 2), clip(5, 28, 1), clip(6, 27, 2, "2026-08-25")];
  const rows = libraryRows(null, server, FIXTURE_NAMES, runSets);
  const shown = (id: string) => rows.find((r) => r.id === id)?.set;
  assert.deepEqual(["c1", "c2", "c3", "c4"].map(shown), [1, 2, 3, 4]);
  assert.deepEqual(["c1", "c2", "c3", "c4", "c5"].map((id, i) => fokus.get(`${sets[i]?.[0]}#${sets[i]?.[1]}`)?.index), ["c1", "c2", "c3", "c4", "c5"].map(shown));
  assert.equal(shown("c5"), 1); // the next exercise starts its own run
  assert.equal(shown("c6"), 2); // its week is not in strength_sets: set_no
  assert.match(rows.find((r) => r.id === "c4")?.meta ?? "", /· sæt 4 ·/);
  // A clip not yet synced (no row) is numbered from its own set key.
  const local: ClipIndexEntry = { id: "u1", setKey: { date: today, sessionNo: 1, row: 27, set: 1 }, ext: "mp4", recordedAt: `${today}T18:00:00Z`, durationS: 30, starred: false, starSynced: true, state: "done" };
  assert.equal(libraryRows([local], [], FIXTURE_NAMES, runSets)[0]?.set, 3);
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
  assert.equal(rows.length, 8);
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

test("an afbrudt clip has no server row: it shows the name stack stored at Optag, else Optagelse", () => {
  const base: ClipIndexEntry = {
    id: "a1", setKey: { date: today, sessionNo: 1, row: 25, set: 2 }, ext: "webm", recordedAt: `${today}T08:00:00.000Z`,
    durationS: 31, starred: false, starSynced: true, state: "afbrudt",
  };
  const [named] = libraryRows([{ ...base, names: { exercise: "Squat", variant: "Pause Squat" } }], [], FIXTURE_NAMES);
  assert.equal(named?.kind, "afbrudt");
  assert.equal(named?.exercise, "Squat");
  assert.equal(named?.variant, "Pause Squat");
  assert.equal(named?.sr, "Afspil Pause Squat, sæt 2, 19. oktober, 31 sekunder, afbrudt.");
  const [plain] = libraryRows([{ ...base, names: { exercise: "Bench", variant: null } }], [], FIXTURE_NAMES);
  assert.equal(plain?.exercise, "Bench");
  assert.equal(plain?.variant, null);
  const [older] = libraryRows([base], [], FIXTURE_NAMES); // an entry from before the stack was stored
  assert.equal(older?.exercise, "Optagelse");
});

test("player history: one entry on open; Luk/Escape go back over it, else close at once", () => {
  const ours = { clipPlayer: true, __NA: true }; // Next merges its own keys into a pushed state
  const theirs = { __NA: true };
  assert.equal(playerShouldPush(theirs), true, "open pushes");
  assert.equal(playerShouldPush(null), true);
  assert.equal(playerShouldPush(ours), false, "a re-run effect (a star tap, the dev double mount) pushes nothing");
  assert.equal(playerCloseVia(ours), "back", "Luk leaves no entry behind");
  assert.equal(playerCloseVia(theirs), "close", "the entry is gone (popped): close without another back");
  assert.equal(playerCloseVia(undefined), "close");
  assert.equal(playerCloseVia({ clipPlayer: "yes" }), "close");
});

test("a clip refused for good is not retried", () => {
  const base = { id: "a", setKey: { date: "2026-10-16", sessionNo: 1, row: 30, set: 1 }, ext: "webm", recordedAt: "2026-10-16T10:00:00Z", durationS: 12, starred: false, starSynced: true, state: "done", synced: false } as const;
  assert.deepEqual(unsyncedClips([base as ClipIndexEntry]).map((e) => e.id), ["a"]);
  assert.deepEqual(unsyncedClips([{ ...base, syncRefused: "too_old" } as ClipIndexEntry]), []);
});

test("a fil mangler row's failed delete reads exactly as video-library.md §8 (user 2026-10-18)", () => {
  assert.equal(MISSING_DELETE_FAILED, "Klippet blev ikke slettet. Prøv igen.");
  const lib = readFileSync(new URL("../src/components/ClipLibrary.tsx", import.meta.url), "utf8");
  assert.ok(lib.includes("setStatus(MISSING_DELETE_FAILED)"), "ClipLibrary shows the constant");
  assert.ok(!lib.includes("Oplysningen blev ikke slettet"), "the replaced wording is gone");
});
