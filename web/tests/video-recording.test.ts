import assert from "node:assert/strict";
import { test } from "node:test";

import { type FokusExercise, fokusView } from "../src/lib/fokus-view.ts";
import { applyTap, type LoggedSet, type SetRef } from "../src/lib/set-taps.ts";
import { memoryClipIndex } from "../src/lib/video/index-store.ts";
import { memoryClipFiles } from "../src/lib/video/opfs.ts";
import { afbrudtLine, clipEntryFor, clipOutcome, saveInputOf, IDLE, isLive, lowSpace, openGuard, recReducer, type RecState, stopInDock, stopSpoken, stopThenDone } from "../src/lib/video/recording.ts";

test("idle → requesting → recording → stopping → saved", () => {
  let s: RecState = recReducer(IDLE, { type: "optag" });
  assert.equal(s.kind, "requesting");
  assert.ok(isLive(s) && !stopInDock(s));
  s = recReducer(s, { type: "started", at: 1000 });
  assert.deepEqual(s, { kind: "recording", startedAt: 1000 });
  assert.ok(stopInDock(s));
  s = recReducer(s, { type: "stop" });
  assert.equal(s.kind, "stopping");
  s = recReducer(s, { type: "stopped", durationS: 48.2 });
  assert.deepEqual(s, { kind: "saved", durationS: 48.2 });
  assert.equal(recReducer(s, { type: "clear" }), IDLE);
});

test("hidden while recording: afbrudt, never saved; a stale stopped changes nothing", () => {
  const rec = recReducer(recReducer(IDLE, { type: "optag" }), { type: "started", at: 0 });
  const s = recReducer(rec, { type: "abort", reason: "background", durationS: 31 });
  assert.deepEqual(s, { kind: "afbrudt", reason: "background", durationS: 31 });
  assert.equal(recReducer(s, { type: "stopped", durationS: 31 }), s);
  assert.equal(
    afbrudtLine("background", 31),
    "Optagelsen blev afbrudt, da appen gik i baggrunden. 0:31 er gemt som afbrudt under Optagelser. Sættet er ikke markeret udført.",
  );
  assert.equal(afbrudtLine("failed", 0.4), "Optagelsen stoppede: kameraet svarede ikke. Intet blev gemt. Sættet er ikke markeret udført.");
});

test("denied from a refused prompt; Optag retries; the limit keeps the clip for the done", () => {
  const d = recReducer(recReducer(IDLE, { type: "optag" }), { type: "denied" });
  assert.equal(d.kind, "denied");
  assert.equal(recReducer(d, { type: "optag" }).kind, "requesting");
  const rec = recReducer(recReducer(IDLE, { type: "optag" }), { type: "started", at: 0 });
  const lim = recReducer(rec, { type: "limit", durationS: 2000 });
  assert.deepEqual(lim, { kind: "limit", durationS: 900 });
  assert.ok(!stopInDock(lim));
  assert.equal(recReducer(lim, { type: "stopped", durationS: 900 }).kind, "saved");
});

test("Stop's order: the recorder is stopped before the done tap, the file and row after it", async () => {
  const calls: string[] = [];
  await stopThenDone({
    stopRecorder: async () => {
      await new Promise((r) => setTimeout(r, 5));
      calls.push("recorder stopped");
    },
    done: () => calls.push("done tap"),
    finalise: async () => {
      calls.push("finalise");
    },
  });
  assert.deepEqual(calls, ["recorder stopped", "done tap", "finalise"]);
});

test("a recorder that never stops does not hold the done back past the cap", async () => {
  const calls: string[] = [];
  await stopThenDone({ stopRecorder: () => new Promise<void>(() => undefined), done: () => calls.push("done"), finalise: async () => undefined }, 20);
  assert.deepEqual(calls, ["done"]);
});

test("copy and space", () => {
  assert.equal(stopSpoken("Sæt 2 udført, 2 af 4, Squat"), "Stop, sæt 2 udført, 2 af 4, Squat");
  assert.equal(lowSpace({ usage: 0, quota: 299_000_000 }), true);
  assert.equal(lowSpace({ usage: 0, quota: 301_000_000 }), false);
  assert.equal(lowSpace(null), false);
});

function fakeStream() {
  const stopped: number[] = [];
  const tracks = [0, 1].map((k) => ({ stop: () => void stopped.push(k) }));
  return { stopped, getTracks: () => tracks };
}

test("a camera that opens after unmount, hide or Annullér is released at once and never recorded", () => {
  const guard = openGuard();
  const attempt = guard.begin();
  assert.equal(guard.pending(), true);
  assert.equal(guard.cancel(), true); // abort while getUserMedia is pending
  assert.equal(guard.pending(), false);
  const late = fakeStream();
  assert.equal(guard.keep(attempt, late), false); // after the await: released, stop there
  assert.deepEqual(late.stopped, [0, 1]);
  assert.equal(guard.cancel(), false); // nothing pending any more: abort has nothing to cancel
});

test("an Optag that opens normally keeps its stream; once settled, abort finds nothing pending", () => {
  const guard = openGuard();
  const attempt = guard.begin();
  const s = fakeStream();
  assert.equal(guard.keep(attempt, s), true);
  assert.deepEqual(s.stopped, []);
  guard.settle(attempt);
  assert.equal(guard.pending(), false);
  assert.equal(guard.cancel(), false);
  // A second Optag supersedes a first still pending: the first's stream is released when it arrives.
  const first = guard.begin();
  const second = guard.begin();
  const s1 = fakeStream();
  assert.equal(guard.keep(first, s1), false);
  assert.deepEqual(s1.stopped, [0, 1]);
  assert.equal(guard.keep(second, fakeStream()), true);
});

test("a clip whose stop event came after the 800 ms cap misses its last chunk: afbrudt (failed), never a short done", () => {
  assert.equal(clipOutcome(true, null), null);
  assert.equal(clipOutcome(false, null), "failed");
  assert.equal(clipOutcome(true, "space"), "space");
  // §14: the line the strip shows for it
  assert.equal(recReducer({ kind: "stopping", startedAt: 0 }, { type: "abort", reason: "failed", durationS: 40 }).kind, "afbrudt");
});

const names = { exercise: "Squat", variant: null };

test("recording on sets 2 and 3: saveClip gets the set Optag was tapped on, by its own uuid", () => {
  for (const set of [2, 3]) {
    const e = clipEntryFor({ id: `id-${set}`, ref: { row: 25, set }, date: "2026-10-19", sessionNo: 1, ext: "mp4", names, recordedAt: "2026-10-19T17:46:35Z" });
    assert.deepEqual(saveInputOf({ ...e, state: "done" }, 52), { id: `id-${set}`, date: "2026-10-19", sessionNo: 1, row: 25, set, durationS: 52 });
  }
});

test("three clips of one set: three files and three index entries, keyed by uuid", async () => {
  const files = memoryClipFiles();
  const index = memoryClipIndex();
  for (const id of ["a", "b", "c"]) {
    const w = await files.create(id, "mp4");
    await w.append(new Blob(["x"]));
    await w.close();
    await index.put(clipEntryFor({ id, ref: { row: 27, set: 2 }, date: "2026-10-19", sessionNo: 1, ext: "mp4", names, recordedAt: "2026-10-19T17:50:00Z" }));
  }
  assert.equal((await files.names()).length, 3);
  const all = await index.all();
  assert.deepEqual(all.map((e) => e.id).toSorted(), ["a", "b", "c"]);
  assert.ok(all.every((e) => e.setKey.row === 27 && e.setKey.set === 2));
});

test("Optag on the pause's Næste · sæt n card records set n (the ref FokusScreen passes is view.next), not the set just done", () => {
  const ex = (row: number, n: number): FokusExercise => ({
    name: "Squat", variant: null, variantId: null, repsText: "5", prescribed: null, bodyweight: false, reference: null, row,
    suggestedKg: null, suggestionBasis: null, suggestionCapped: false, adjustmentKg: null, adjustmentReason: null,
    restMinS: 180, restMaxS: 300, ramp: null, todayKg: 100, todayBasis: "sheet", sets: Array.from({ length: n }, (_, k) => ({ row, set: k + 1 })),
  });
  const exercises = [ex(25, 1), ex(26, 1), ex(27, 2)];
  const order: SetRef[] = [{ row: 25, set: 0 }, { row: 25, set: 1 }, { row: 26, set: 1 }, { row: 27, set: 1 }, { row: 27, set: 2 }];
  let log: ReadonlyMap<string, LoggedSet> = new Map();
  const taps: [string, SetRef][] = [["begin", { row: 25, set: 0 }], ["done", { row: 25, set: 0 }], ["done", { row: 25, set: 1 }], ["done", { row: 26, set: 1 }]];
  taps.forEach(([kind, ref], k) => {
    log = applyTap(order, log, kind as "done", ref, `2026-10-19T17:${String(40 + k).padStart(2, "0")}:00.000Z`, null, new Map());
  });
  const v = fokusView({ exercises, pairs: [], order, week: 2, session: 1 }, log);
  assert.equal(v.kind, "set");
  if (v.kind !== "set") return;
  assert.deepEqual(v.next, { row: 27, set: 1 }); // the pause after run set 2 shows run set 3
  const e = clipEntryFor({ id: "p1", ref: v.next, date: "2026-10-19", sessionNo: 1, ext: "mp4", names, recordedAt: "2026-10-19T17:44:00Z" });
  assert.deepEqual([saveInputOf(e, 40).row, saveInputOf(e, 40).set], [27, 1]);
});
