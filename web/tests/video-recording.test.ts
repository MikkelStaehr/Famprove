import assert from "node:assert/strict";
import { test } from "node:test";

import { afbrudtLine, clipOutcome, IDLE, isLive, lowSpace, openGuard, recReducer, type RecState, stopInDock, stopSpoken, stopThenDone } from "../src/lib/video/recording.ts";

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
