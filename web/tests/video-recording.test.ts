import assert from "node:assert/strict";
import { test } from "node:test";

import { afbrudtLine, IDLE, isLive, lowSpace, recReducer, type RecState, stopInDock, stopSpoken, stopThenDone } from "../src/lib/video/recording.ts";

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
