import assert from "node:assert/strict";
import { test } from "node:test";

import { expectedReps, findLift, type SetClipAutoInput, type SetClipAutoResult } from "../src/lib/video/auto-clip.ts";
import { autoMetaWord, fokusAutoLine, isOutcome } from "../src/lib/video/auto-lines.ts";
import { analyseClip, type AutoDeps, type AutoProgress, type ClipMeta } from "../src/lib/video/auto-run.ts";
import type { PoseFrame, PosePoint, PoseResult } from "../src/lib/video/pose-run.ts";

// Tester's checks for clip-auto (design/specs/clip-auto.md §4 criteria 5, 6, 7, 10; §1 lines; messy
// reps text). Synthetic landmarks only: the repo is public.

const META: ClipMeta = { ext: "mp4", durationS: 15, family: "lower", expected: 5 };
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

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
const POSE = (frames: PoseFrame[]): PoseResult => ({ frames, timing: { loadMs: 1, frames: frames.length, msPerFrame: 1, totalMs: 1 } });

function recordingDeps(runPose: AutoDeps["runPose"], warmModel: AutoDeps["warmModel"] = async () => false): { deps: AutoDeps; writes: SetClipAutoInput[] } {
  const writes: SetClipAutoInput[] = [];
  return {
    writes,
    deps: {
      warmModel,
      keyframeTimes: async () => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      runPose,
      setClipAuto: async (input): Promise<SetClipAutoResult> => {
        writes.push(input);
        return { ok: false, reason: "failed" };
      },
      now: () => Date.now(),
    },
  };
}

/** A runPose stub that keeps the run going until `release` (or the signal), reporting frames. */
function heldPose(): { runPose: AutoDeps["runPose"]; release: () => void; progressAfterAbort: number[] } {
  let release = () => {};
  const progressAfterAbort: number[] = [];
  const runPose: AutoDeps["runPose"] = (_b, o) =>
    new Promise<PoseResult>((resolve, reject) => {
      o.onProgress(1, 10);
      release = () => {
        o.onProgress(10, 10);
        if (o.signal.aborted) progressAfterAbort.push(10);
        resolve(POSE(squatFrames()));
      };
      o.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  return { runPose, release: () => release(), progressAfterAbort };
}

test("criterion 7: a new Optag mid-run aborts the old run; only the new clip is written", async () => {
  const held = heldPose();
  let calls = 0;
  const writes: SetClipAutoInput[] = [];
  const deps: AutoDeps = {
    warmModel: async () => false,
    keyframeTimes: async () => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    runPose: (b, o) => (calls++ === 0 ? held.runPose(b, o) : Promise.resolve(POSE(squatFrames()))),
    setClipAuto: async (input) => {
      writes.push(input);
      return { ok: false, reason: "failed" };
    },
    now: () => Date.now(),
  };
  const first = new AbortController();
  const oldProgress: AutoProgress[] = [];
  const oldRun = analyseClip(A, new Blob([]), META, { signal: first.signal, deps, onProgress: (p) => oldProgress.push(p) });
  await new Promise((r) => setTimeout(r, 5));
  // The hook's optag: stopAuto() aborts the old controller, then the new clip's run starts.
  first.abort();
  const second = new AbortController();
  const newRun = analyseClip(B, new Blob([]), META, { signal: second.signal, deps });
  assert.equal((await oldRun).kind, "aborted");
  const out = await newRun;
  assert.equal(out.kind, "clipped");
  assert.deepEqual(
    writes.map((w) => w.id),
    [B],
    "no auto_* write for the old clip",
  );
  assert.ok(oldProgress.every((p) => !isOutcome(p as never)), "the old run never reports an outcome");
});

test("criterion 7: an abort that lands while runPose ignores it still writes nothing", async () => {
  // A runPose that does not reject on abort but resolves later: analyseClip must check the signal itself.
  let resolvePose: (r: PoseResult) => void = () => {};
  const { deps, writes } = recordingDeps(() => new Promise<PoseResult>((r) => (resolvePose = r)));
  const ctrl = new AbortController();
  const run = analyseClip(A, new Blob([]), META, { signal: ctrl.signal, deps });
  await new Promise((r) => setTimeout(r, 1));
  ctrl.abort();
  resolvePose(POSE(squatFrames()));
  assert.equal((await run).kind, "aborted");
  assert.equal(writes.length, 0);
});

test("criterion 7: an abort during the model download writes nothing and never starts runPose", async () => {
  let poseStarted = false;
  const ctrl = new AbortController();
  const { deps, writes } = recordingDeps(
    async () => {
      poseStarted = true;
      return POSE(squatFrames());
    },
    async (_s, onPct) => {
      onPct(40);
      ctrl.abort();
      return true;
    },
  );
  assert.equal((await analyseClip(A, new Blob([]), META, { signal: ctrl.signal, deps })).kind, "aborted");
  assert.equal(poseStarted, false);
  assert.equal(writes.length, 0);
});

/** Busy-waits `ms` on the event loop (a stand-in for one frame's synchronous detectForVideo). */
function busy(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // spin
  }
}

// Criterion 6 asks for a 30 s stub. The default here is 3 s so `pnpm test` stays quick; the tester
// ran it once with CLIP_AUTO_STUB_MS=30000. The stub mirrors pose-run.ts: one synchronous detection
// per frame (busy 40 ms, a slow phone frame), then a yield. It yields with setImmediate, one task per
// frame as in a browser (Node's timers phase may run several expired 0 ms timers back to back, which
// a browser's task queue does not). This proves analyseClip adds no long synchronous stretch of its
// own; the real per-frame detectForVideo cost on the phone is not measured here.
// Deterministic form (wall-clock gaps flaked under the suite's parallel CPU load): a tap's handler gets
// the loop between every two frames, so a tap waits at most one frame's detection.
test("criterion 6: during a stubbed analysis a tap gets the loop between every two frames, and the 1 s timer keeps ticking", async () => {
  const stubMs = Number(process.env.CLIP_AUTO_STUB_MS ?? "3000");
  const frameMs = 40;
  const { deps } = recordingDeps(async (_b, o) => {
    const frames = Math.round(stubMs / frameMs);
    for (let i = 1; i <= frames; i++) {
      busy(frameMs);
      trace.push("frame");
      o.onProgress(i, frames);
      await new Promise((r) => setImmediate(r));
      if (o.signal.aborted) throw new DOMException("aborted", "AbortError");
    }
    return POSE(squatFrames());
  });
  const trace: string[] = [];
  let beating = true;
  const beat = () => {
    trace.push("tap");
    if (beating) setImmediate(beat); // a tap's handler, queued all the time
  };
  setImmediate(beat);
  const ticks: number[] = [];
  const t0 = performance.now();
  const timer = setInterval(() => ticks.push(performance.now() - t0), 1000); // the rest timer
  const progress: AutoProgress[] = [];
  const out = await analyseClip(A, new Blob([]), META, { signal: new AbortController().signal, deps, onProgress: (p) => progress.push(p) });
  beating = false;
  clearInterval(timer);
  assert.equal(out.kind, "clipped");
  const elapsed = performance.now() - t0;
  const back2back = trace.findIndex((e, i) => e === "frame" && trace[i + 1] === "frame");
  assert.equal(back2back, -1, "two frames ran with no tap between them");
  assert.ok(ticks.length >= Math.floor(elapsed / 1000) - 1, `rest timer ticked ${ticks.length} times in ${elapsed.toFixed(0)} ms`);
  const pcts = progress.filter((p) => p.kind === "running").map((p) => p.pct);
  assert.deepEqual(pcts, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
});

test("criterion 6: findLift (the one synchronous step after the frames) takes < 100 ms on a 900 s clip at 10 fps", () => {
  const frames: PoseFrame[] = [];
  const base = squatFrames();
  const span = base[base.length - 1].t + 0.1;
  for (let k = 0; frames.length < 9000; k++) for (const f of base) frames.push({ t: Math.round((f.t + k * span) * 1000) / 1000, landmarks: f.landmarks });
  const t = performance.now();
  findLift(frames.slice(0, 9000), null, "lower", 900);
  const ms = performance.now() - t;
  assert.ok(ms < 100, `findLift took ${ms.toFixed(1)} ms`);
});

test("criterion 5: the spoken text has no % or digits on a phase; the outcome is spoken in full", () => {
  for (const p of [{ kind: "model", pct: 40 }, { kind: "model", pct: null }, { kind: "running", pct: 70 }] as const) {
    const line = fokusAutoLine(p);
    assert.equal(line.figureHidden, true);
    assert.doesNotMatch(line.spoken, /[0-9%]/);
    assert.equal(isOutcome(p), false);
  }
  const clipped = fokusAutoLine({ kind: "clipped", inS: 12.3, outS: 48 });
  assert.equal(clipped.spoken, "Klippet automatisk 12,3–48,0 s");
  assert.equal(isOutcome({ kind: "clipped", inS: 12.3, outS: 48 }), true);
  assert.equal(isOutcome({ kind: "low_confidence" }), true);
  assert.equal(isOutcome({ kind: "failed" }), true);
});

test("criterion 3: the clipped line uses comma decimals and never a dot, also for awkward values", () => {
  for (const [inS, outS] of [
    [12.3, 48],
    [0, 0.1],
    [4.25, 39.95],
    [0.04, 899.96],
  ] as const) {
    const line = fokusAutoLine({ kind: "clipped", inS, outS });
    assert.doesNotMatch(`${line.figure} ${line.spoken}`, /\d\.\d/, `${inS}/${outS}`);
    assert.match(line.figure ?? "", /^[\d:]+,\d–[\d:]+,\d( s)?$/); // clip-cut's format (m:ss,s from a minute)
  }
});

test("criterion 10: WebM gets no analysis, no write, and no meta word whatever the server holds", async () => {
  let ran = false;
  const { deps, writes } = recordingDeps(async () => {
    ran = true;
    return POSE(squatFrames());
  });
  assert.deepEqual(await analyseClip(A, new Blob([]), { ...META, ext: "webm" }, { signal: new AbortController().signal, deps }), { kind: "skipped" });
  assert.equal(ran, false);
  assert.equal(writes.length, 0);
  for (const autoStatus of [null, "clipped", "low_confidence", "failed"] as const) {
    assert.equal(autoMetaWord("webm", { clipInS: null, clipOutS: null, autoStatus }, false), null);
    assert.equal(autoMetaWord("webm", { clipInS: null, clipOutS: null, autoStatus }, true), null);
  }
});

test("messy reps text: comma or dot decimals, blanks and junk are null, never 0 or NaN", () => {
  for (const text of ["5,5", "5.5", "5,0", "", "   ", "AMRAP", "x", "0", "-3", "1e1", "5 x 3", "0 - 0"]) {
    const n = expectedReps(null, text);
    assert.equal(n, null, JSON.stringify(text));
  }
  assert.equal(expectedReps(null, " 5 "), 5);
  assert.equal(expectedReps(null, "8–10"), 10);
  assert.equal(expectedReps(null, " 10 - 8 "), 10);
  // reps_done that isn't a positive whole number falls back to the sheet's text.
  assert.equal(expectedReps(0, "6"), 6);
  assert.equal(expectedReps(Number.NaN, "6"), 6);
  assert.equal(expectedReps(-2, null), null);
});
