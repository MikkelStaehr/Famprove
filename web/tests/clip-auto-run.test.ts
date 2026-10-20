import assert from "node:assert/strict";
import { test } from "node:test";

import type { SetClipAutoInput, SetClipAutoResult } from "../src/lib/video/auto-clip.ts";
import { autoMetaWord, editLabel, FAILED_LINE, fokusAutoLine, inPickupWindow, LOW_LINE, pickupQueue, PLAYER_FAILED_LINE, PLAYER_LOW_LINE, PLAYER_WAITING_LINE, playerAutoLine } from "../src/lib/video/auto-lines.ts";
import { analyseClip, type AutoDeps, type AutoProgress, bytePct, chooseMode, type ClipMeta, stepPct } from "../src/lib/video/auto-run.ts";
import { AUTO_VERSION_KEY, parseAutoVersions, readAutoVersions, recordAutoVersion } from "../src/lib/video/auto-version.ts";
import { ALGO_VERSION } from "../src/lib/video/auto-clip.ts";
import { poseCapMs } from "../src/lib/video/pose-run.ts";
import type { VideoClipRow } from "../src/lib/video/clips.ts";
import type { ClipIndexEntry } from "../src/lib/video/index-store.ts";
import { type PoseFrame, PoseError, type PosePoint, type PoseResult } from "../src/lib/video/pose-run.ts";

// Synthetic landmark series only (the repo is public): never real frames.

const ID = "00000000-0000-4000-8000-000000000001";

/** 5 squat reps (hips down = y up), 2 s rest either side, 10 fps. */
function squatFrames(): PoseFrame[] {
  const fps = 10;
  const rep = 2.2;
  const end = 2 + 5 * rep + 2;
  const frames: PoseFrame[] = [];
  for (let i = 0; i / fps < end; i++) {
    const t = Math.round((i / fps) * 1000) / 1000;
    const u = t - 2;
    const k = u >= 0 && u < 5 * rep ? u % rep : -1;
    const shape = k < 0 ? 0 : k < 1 ? k : k < 1.2 ? 1 : k < 2.2 ? 2.2 - k : 0;
    const y = 0.4 + 0.2 * shape;
    const pts: PosePoint[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0.9] as const);
    pts[23] = [0.45, y, 0.95];
    pts[24] = [0.55, y, 0.95];
    frames.push({ t, landmarks: pts });
  }
  return frames;
}

/** Keyframes 1 s apart over META's 15 s: seek mode. */
const DENSE_KEYFRAMES = Array.from({ length: 15 }, (_, i) => i);
const META: ClipMeta = { ext: "mp4", durationS: 15, family: "lower", expected: 5 };
const POSE = (frames: PoseFrame[]): PoseResult => ({ frames, timing: { loadMs: 1, frames: frames.length, msPerFrame: 1, totalMs: 1 } });

function deps(over: Partial<AutoDeps> = {}): { deps: AutoDeps; writes: SetClipAutoInput[] } {
  const writes: SetClipAutoInput[] = [];
  let clock = 0;
  return {
    writes,
    deps: {
      warmModel: async () => false,
      keyframeTimes: async () => DENSE_KEYFRAMES,
      runPose: async (_b, o) => {
        for (let i = 1; i <= 20; i++) o.onProgress(i, 20);
        return POSE(squatFrames());
      },
      setClipAuto: async (input): Promise<SetClipAutoResult> => {
        writes.push(input);
        return { ok: false, reason: "failed" };
      },
      now: () => (clock += 1500),
      ...over,
    },
  };
}

test("analyseClip: a clear lift is clipped and written once with its run ms", async () => {
  const d = deps();
  const seen: AutoProgress[] = [];
  const out = await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, onProgress: (p) => seen.push(p), deps: d.deps });
  assert.equal(out.kind, "clipped");
  assert.equal(d.writes.length, 1);
  assert.equal(d.writes[0].status, "clipped");
  assert.equal(d.writes[0].runMs, 1500);
  assert.deepEqual(Object.keys(d.writes[0]).toSorted(), ["id", "inS", "outS", "runMs", "status"], "never landmarks or frames");
  assert.ok(seen.every((p) => p.kind === "running"), "a cached model shows no model phase");
  assert.deepEqual([...new Set(seen.map((p) => p.pct))], [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], "steps of 10, each once");
});

test("analyseClip: a model not cached shows the model phase first", async () => {
  const d = deps({
    warmModel: async (_s, onPct) => {
      onPct(null);
      onPct(40);
      return true;
    },
  });
  const seen: AutoProgress[] = [];
  await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, onProgress: (p) => seen.push(p), deps: d.deps });
  assert.deepEqual(seen.slice(0, 3), [{ kind: "model", pct: null }, { kind: "model", pct: 40 }, { kind: "running", pct: 0 }]);
});

test("analyseClip: no lift found is low_confidence, written with null in/out", async () => {
  const d = deps({ runPose: async () => POSE(squatFrames().map((f) => ({ t: f.t, landmarks: null }))) });
  const out = await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, deps: d.deps });
  assert.equal(out.kind, "low_confidence");
  assert.deepEqual(d.writes.map((w) => [w.status, w.inS, w.outS]), [["low_confidence", null, null]]);
});

test("analyseClip: an error is failed, and failed is written", async () => {
  const d = deps({
    runPose: async () => {
      throw new Error("detect");
    },
  });
  const out = await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, deps: d.deps });
  assert.equal(out.kind, "failed");
  assert.deepEqual(d.writes.map((w) => w.status), ["failed"]);
});

test("analyseClip: an abort writes nothing (mid-run, or before the write)", async () => {
  const ctrl = new AbortController();
  const d = deps({
    runPose: async () => {
      ctrl.abort();
      throw new Error("afbrudt");
    },
  });
  assert.deepEqual(await analyseClip(ID, new Blob([]), META, { signal: ctrl.signal, deps: d.deps }), { kind: "aborted" });
  const ctrl2 = new AbortController();
  const d2 = deps({
    runPose: async () => {
      ctrl2.abort();
      return POSE(squatFrames());
    },
  });
  assert.deepEqual(await analyseClip(ID, new Blob([]), META, { signal: ctrl2.signal, deps: d2.deps }), { kind: "aborted" });
  assert.equal(d.writes.length + d2.writes.length, 0);
});

test("analyseClip: WebM is skipped, nothing runs or is written", async () => {
  let ran = false;
  const d = deps({
    runPose: async () => {
      ran = true;
      return POSE([]);
    },
  });
  const out = await analyseClip(ID, new Blob([]), { ...META, ext: "webm" }, { signal: new AbortController().signal, deps: d.deps });
  assert.deepEqual(out, { kind: "skipped" });
  assert.equal(ran, false);
  assert.equal(d.writes.length, 0);
});

test("stepPct / bytePct: steps of 10; no total = no %", () => {
  assert.equal(stepPct(0, 37), 0);
  assert.equal(stepPct(15, 37), 40);
  assert.equal(stepPct(37, 37), 100);
  assert.equal(bytePct(5, null), null);
  assert.equal(bytePct(55, 100), 50);
});

test("§1: the line per phase, the % aria-hidden and never spoken", () => {
  const model = fokusAutoLine({ kind: "model", pct: 40 });
  assert.equal(`${model.words} ${model.figure}`, "Henter klippemodel … 40 %");
  assert.equal(model.figureHidden, true);
  assert.equal(fokusAutoLine({ kind: "model", pct: null }).figure, null, "no Content-Length: no %");
  const running = fokusAutoLine({ kind: "running", pct: 40 });
  assert.equal(`${running.words} ${running.figure}`, "Klipper video … 40 %");
  assert.ok(!running.spoken.includes("%"));
  const clipped = fokusAutoLine({ kind: "clipped", inS: 12.3, outS: 48 });
  assert.equal(`${clipped.words} ${clipped.figure}`, "Klippet automatisk 12,3–48,0 s");
  assert.equal(clipped.spoken, "Klippet automatisk 12,3–48,0 s");
  assert.equal(fokusAutoLine({ kind: "low_confidence" }).words, "Kunne ikke finde løftet sikkert. Klip selv i Optagelser under Træning.");
  assert.equal(LOW_LINE, fokusAutoLine({ kind: "low_confidence" }).spoken);
  assert.equal(fokusAutoLine({ kind: "failed" }).words, "Automatisk klip mislykkedes. Hele videoen er gemt.");
  assert.equal(FAILED_LINE, fokusAutoLine({ kind: "failed" }).spoken);
});

const NONE = { clipInS: null, clipOutS: null, autoStatus: null } as const;

test("§2: the meta word per state", () => {
  assert.equal(autoMetaWord("mp4", { ...NONE, clipInS: 1, clipOutS: 5, autoStatus: "clipped" }, false), "klippet");
  assert.equal(autoMetaWord("mp4", { ...NONE, autoStatus: "clipped" }, false), "auto-klippet");
  assert.equal(autoMetaWord("mp4", { ...NONE, autoStatus: "low_confidence" }, false), "klip selv");
  assert.equal(autoMetaWord("mp4", { ...NONE, autoStatus: "failed" }, false), "klip selv");
  assert.equal(autoMetaWord("mp4", NONE, true), "klipper …");
  assert.equal(autoMetaWord("mp4", NONE, false), "venter på klip", "not analysed yet: waiting, never klip selv");
  assert.equal(autoMetaWord("webm", { ...NONE, autoStatus: "failed" }, false), null);
  assert.equal(autoMetaWord("webm", NONE, false), null);
  assert.equal(autoMetaWord("mp4", null, false), null);
});

test("§2: the player's line and the button", () => {
  assert.deepEqual(playerAutoLine("low_confidence", null), { words: PLAYER_LOW_LINE, figure: null });
  assert.deepEqual(playerAutoLine("failed", null), { words: PLAYER_FAILED_LINE, figure: null });
  assert.deepEqual(playerAutoLine(null, { pct: 40 }), { words: "Klipper video …", figure: "40 %" });
  assert.deepEqual(playerAutoLine(null, null), { words: "Venter på klip", figure: null });
  assert.equal(PLAYER_WAITING_LINE, "Venter på klip");
  assert.equal(playerAutoLine("clipped", null), null);
  assert.equal(editLabel(NONE), "Klip", "waiting reads Klip, never Klip selv");
  assert.equal(editLabel({ ...NONE, autoStatus: "low_confidence" }), "Klip selv");
  assert.equal(editLabel({ ...NONE, autoStatus: "failed" }), "Klip selv");
  assert.equal(editLabel({ ...NONE, clipInS: 1, clipOutS: 4, autoStatus: "failed" }), "Ret klip");
  assert.equal(editLabel({ ...NONE, autoStatus: "clipped" }), "Klip");
});

function row(n: number, recordedAt: string, over: Partial<VideoClipRow> = {}): VideoClipRow {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, date: recordedAt.slice(0, 10), session: 1, row: 20, set: 1, exerciseId: 1, variantId: null,
    recordedAt, durationS: 30, starred: false, clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null, ...over,
  };
}
function entry(r: VideoClipRow, over: Partial<ClipIndexEntry> = {}): ClipIndexEntry {
  return {
    id: r.id, setKey: { date: r.date, sessionNo: 1, row: 20, set: 1 }, ext: "mp4", recordedAt: r.recordedAt, durationS: 30, starred: false, starSynced: true, state: "done", ...over,
  };
}

test("pickup: auto_status null or an older version, MP4, a local done file, the last 7 days; newest first", () => {
  const now = new Date("2026-10-20T12:00:00+02:00");
  const a = row(1, "2026-10-19T10:00:00+02:00");
  const b = row(2, "2026-10-20T09:00:00+02:00");
  const ran = row(3, "2026-10-20T08:00:00+02:00", { autoStatus: "failed" });
  const own = row(4, "2026-10-20T08:00:00+02:00", { clipInS: 1, clipOutS: 9 });
  const old = row(5, "2026-10-12T10:00:00+02:00");
  const webm = row(6, "2026-10-20T07:00:00+02:00");
  const noFile = row(7, "2026-10-20T07:00:00+02:00");
  const afbrudt = row(8, "2026-10-20T06:00:00+02:00");
  const local = [entry(a), entry(b), entry(ran), entry(own), entry(old), entry(webm, { ext: "webm" }), entry(afbrudt, { state: "afbrudt" })];
  const rows = [a, b, ran, own, old, webm, noFile, afbrudt];
  // No version recorded: ran (failed) counts as version 1 < ALGO_VERSION, so it is re-run; an own range no longer excludes.
  assert.deepEqual(pickupQueue(local, rows, now).map((r) => r.id), [b.id, ran.id, own.id, a.id]);
  // ran analysed with this version: not again; null is analysed whatever its record says.
  const current = { [ran.id]: ALGO_VERSION, [b.id]: ALGO_VERSION };
  assert.deepEqual(pickupQueue(local, rows, now, current).map((r) => r.id), [b.id, own.id, a.id]);
  assert.deepEqual(pickupQueue(local, rows, now, { [ran.id]: 1 }).map((r) => r.id), [b.id, ran.id, own.id, a.id]);
  const clipped = row(9, "2026-10-19T09:00:00+02:00", { autoStatus: "clipped", autoInS: 1, autoOutS: 5 });
  assert.deepEqual(pickupQueue([entry(clipped)], [clipped], now, {}).map((r) => r.id), [clipped.id]);
  assert.deepEqual(pickupQueue([entry(clipped)], [clipped], now, { [clipped.id]: ALGO_VERSION }), []);
});

test("auto versions: localStorage map, unreadable = empty, recorded as ALGO_VERSION", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  assert.deepEqual(readAutoVersions(store), {});
  recordAutoVersion(store, "x");
  recordAutoVersion(store, "y");
  assert.deepEqual(JSON.parse(mem.get(AUTO_VERSION_KEY)!), { x: ALGO_VERSION, y: ALGO_VERSION });
  assert.deepEqual(parseAutoVersions("not json"), {});
  assert.deepEqual(parseAutoVersions("[1]"), {});
  assert.deepEqual(parseAutoVersions('{"a":2,"b":"2","c":1.5}'), { a: 2 });
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
  assert.deepEqual(readAutoVersions(broken), {});
  recordAutoVersion(broken, "x"); // never throws
  recordAutoVersion(null, "x");
  assert.equal(ALGO_VERSION, 2);
});

test("mode: largest keyframe gap ≤ 1.1 s seeks, else (or unknown) plays", () => {
  const every = (gap: number, d: number) => Array.from({ length: Math.floor(d / gap) + 1 }, (_, i) => i * gap).filter((t) => t < d);
  assert.deepEqual(chooseMode(every(0.9, 20), 20), { mode: "seek", why: "søg" });
  assert.deepEqual(chooseMode(every(1.2, 20), 20).mode, "play");
  assert.deepEqual(chooseMode([0, 4.1, 8.2, 12.3], 15), { mode: "play", why: "afspil: nøglebilleder op til 4,1 s" });
  assert.deepEqual(chooseMode([0, 1, 2], 10), { mode: "play", why: "afspil: nøglebilleder op til 8,0 s" }, "the last keyframe to the end counts");
  assert.deepEqual(chooseMode(null, 20), { mode: "play", why: "afspil: nøglebilleder ukendt" });
  assert.deepEqual(chooseMode([], 20), { mode: "play", why: "afspil: nøglebilleder ukendt" });
});

test("mode: analyseClip reads the keyframes, seeks or plays, and retries a seek video error once in play", async () => {
  const modes: string[] = [];
  const recorder = (fail: (mode: string) => Error | null) =>
    deps({
      runPose: async (_b, o) => {
        modes.push(o.mode);
        const e = fail(o.mode);
        if (e !== null) throw e;
        return POSE(squatFrames());
      },
    });
  const seek = recorder(() => null);
  const out = await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, deps: seek.deps });
  assert.deepEqual(modes, ["seek"]);
  assert.ok(out.kind === "clipped" && out.mode?.why === "søg");
  modes.length = 0;
  const sparse = recorder(() => null);
  const playOut = await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, deps: { ...sparse.deps, keyframeTimes: async () => [0, 4.1, 8.2, 12.3] } });
  assert.deepEqual(modes, ["play"]);
  assert.ok(playOut.kind === "clipped" && playOut.mode?.why === "afspil: nøglebilleder op til 4,1 s");
  modes.length = 0;
  const unknown = recorder(() => null);
  await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, deps: { ...unknown.deps, keyframeTimes: async () => { throw new Error("no moov"); } } });
  assert.deepEqual(modes, ["play"]);
  modes.length = 0;
  const retry = recorder((m) => (m === "seek" ? new PoseError("video", "seeked kom ikke inden for 5 s") : null));
  const retried = await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, deps: retry.deps });
  assert.deepEqual(modes, ["seek", "play"], "one retry, in play");
  assert.ok(retried.kind === "clipped" && retried.mode?.why === "afspil: søgning fejlede");
  assert.equal(retry.writes.length, 1);
  modes.length = 0;
  const detect = recorder(() => new PoseError("detect", "boom"));
  const failed = await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, deps: detect.deps });
  assert.deepEqual(modes, ["seek"], "only a video error is retried");
  assert.equal(failed.kind, "failed");
  modes.length = 0;
  const hidden = recorder((m) => (m === "play" ? new PoseError("aborted", "siden blev skjult") : null));
  const gone = await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, deps: { ...hidden.deps, keyframeTimes: async () => [0, 5] } });
  assert.deepEqual(gone, { kind: "aborted" }, "a hidden page aborts the play run: nothing written");
  assert.equal(hidden.writes.length, 0);
  modes.length = 0;
  // review 2026-10-20: a throttled offscreen element gives too few frames (a video error): one retry in seek.
  const throttled = recorder((m) => (m === "play" ? new PoseError("video", "afspilning gav kun 0 af 200 billeder") : null));
  const back = await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, deps: { ...throttled.deps, keyframeTimes: async () => [0, 5] } });
  assert.deepEqual(modes, ["play", "seek"], "one retry, in seek");
  assert.ok(back.kind === "clipped" && back.mode?.why === "søg: afspilning fejlede");
  assert.equal(throttled.writes.length, 1);
});

test("the cap scales with the clip: max(90 s, duration × 1.5 + 30 s)", () => {
  assert.equal(poseCapMs(null), 90_000);
  assert.equal(poseCapMs(20), 90_000);
  assert.equal(poseCapMs(40), 90_000);
  assert.equal(poseCapMs(60), 120_000);
  assert.equal(poseCapMs(326), 519_000);
});

test("analyseClip: a failure keeps its step and message on the phone, and writes only failed", async () => {
  const pe = new PoseError("video", "seeked kom ikke inden for 5 s");
  pe.reached = { done: 41, of: 60, seek: { count: 42, meanMs: 900, maxMs: 5000, maxAt: 41 } };
  const d = deps({
    runPose: async () => {
      throw pe;
    },
  });
  const out = await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, deps: d.deps });
  assert.equal(out.kind, "failed");
  if (out.kind === "failed") assert.deepEqual(out.error, { step: "video", message: "seeked kom ikke inden for 5 s", reached: pe.reached });
  assert.deepEqual(d.writes, [{ id: ID, status: "failed", inS: null, outS: null, runMs: d.writes[0].runMs }]);
  const m = deps({
    warmModel: async () => {
      throw new Error("offline");
    },
  });
  const outM = await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, deps: m.deps });
  assert.ok(outM.kind === "failed" && outM.error.step === "model" && outM.error.message === "offline" && outM.error.reached === null);
  const p = deps({
    runPose: async () => {
      throw new Error("boom");
    },
  });
  const outP = await analyseClip(ID, new Blob([]), META, { signal: new AbortController().signal, deps: p.deps });
  assert.ok(outP.kind === "failed" && outP.error.step === "pose");
});

test("clip-auto-2 review: Venter på klip only inside the pickup window; play retries in seek mode", async () => {
  const now = new Date("2026-10-27T12:00:00Z");
  assert.equal(inPickupWindow("2026-10-21T10:00:00Z", now), true);
  assert.equal(inPickupWindow("2026-10-19T10:00:00Z", now), false);
  const waiting = { clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null } as const;
  assert.equal(autoMetaWord("mp4", waiting, false, true), "venter på klip");
  assert.equal(autoMetaWord("mp4", waiting, false, false), null);
  assert.equal(playerAutoLine(null, null, false), null);
});
