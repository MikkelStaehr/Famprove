import assert from "node:assert/strict";
import { test } from "node:test";

import { ALGO_VERSION, AUTO_CLIP, diagnoseLift, expectedReps, findLift, liftFamily, parseSetClipAutoInput, validateClipAuto, type Joint } from "../src/lib/video/auto-clip.ts";
import type { PoseFrame, PosePoint } from "../src/lib/video/pose-run.ts";

// Synthetic landmark series only (the repo is public): never real frames.

const IDX: Record<Joint, readonly [number, number]> = { hips: [23, 24], knees: [25, 26], wrists: [15, 16], elbows: [13, 14] };

/** A rep that starts at t0: linear away from rest over 1 s, 0.2 s still, linear back over 1 s (0…1). */
const REP_S = 2.2;
function repShape(t: number, t0: number): number {
  const u = t - t0;
  if (u <= 0 || u >= REP_S) return 0;
  if (u < 1) return u;
  if (u < 1.2) return 1;
  return (REP_S - u) / 1;
}

/** A seeded PRNG (mulberry32) and a Gaussian from it, so noise is the same every run. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

type Spec = {
  readonly durationS: number;
  readonly fps?: number;
  /** y of the moving joints at time t (normalised, growing downwards). */
  readonly y: (t: number) => number;
  /** Which pairs move with y (others sit still at 0.5); visibility per pair. */
  readonly moving: readonly Joint[];
  readonly visibility?: Partial<Record<Joint, number>>;
  readonly noise?: number;
  /** Share of frames with no person found. */
  readonly dropShare?: number;
  readonly seed?: number;
};

function series(spec: Spec): PoseFrame[] {
  const fps = spec.fps ?? 10;
  const r = rng(spec.seed ?? 1);
  const frames: PoseFrame[] = [];
  for (let i = 0; i / fps < spec.durationS; i++) {
    const t = Math.round((i / fps) * 1000) / 1000;
    if (spec.dropShare !== undefined && r() < spec.dropShare) {
      frames.push({ t, landmarks: null });
      continue;
    }
    const pts: PosePoint[] = Array.from({ length: 33 }, () => [0.5, 0.5, 0.9] as const);
    for (const joint of Object.keys(IDX) as Joint[]) {
      const vis = spec.visibility?.[joint] ?? 0.9;
      const moves = spec.moving.includes(joint);
      for (const k of IDX[joint]) {
        const y = (moves ? spec.y(t) : 0.5) + (spec.noise ?? 0) * gauss(r);
        pts[k] = [0.5, y, vis];
      }
    }
    frames.push({ t, landmarks: pts });
  }
  return frames;
}

const STARTS = [3, 6, 9, 12, 15];
/** Truth for the 5-rep series: the first rep's start − 0.5 and the last rep's end + 0.5. */
const TRUTH = { inS: STARTS[0] - AUTO_CLIP.PAD_S, outS: STARTS[4] + REP_S + AUTO_CLIP.PAD_S };
const reps5 = (rest: number, amp: number, starts = STARTS) => (t: number) => rest + amp * starts.reduce((s, t0) => s + repShape(t, t0), 0);

function assertClipped(result: ReturnType<typeof findLift>, joint: Joint, reps: number, truth = TRUTH): { inErr: number; outErr: number } {
  assert.equal(result.status, "clipped", JSON.stringify(result));
  if (result.status !== "clipped") throw new Error("unreachable");
  assert.equal(result.joint, joint);
  assert.equal(result.reps, reps);
  const inErr = result.inS - truth.inS;
  const outErr = result.outS - truth.outS;
  assert.ok(Math.abs(inErr) <= 0.2 + 1e-9, `in ${result.inS} vs ${truth.inS}`);
  assert.ok(Math.abs(outErr) <= 0.2 + 1e-9, `out ${result.outS} vs ${truth.outS}`);
  return { inErr, outErr };
}

test("squat, 5 reps from the side: hips, in/out within 0.2 s", () => {
  const frames = series({ durationS: 20, y: reps5(0.45, 0.2), moving: ["hips", "knees"] });
  assertClipped(findLift(frames, 5, "lower", 20), "hips", 5);
});

test("squat at pose-run's default 5 fps", () => {
  const frames = series({ durationS: 20, fps: 5, y: reps5(0.45, 0.2), moving: ["hips", "knees"] });
  assertClipped(findLift(frames, 5, "lower", 20), "hips", 5);
});

test("eased reps (cosine, no steady part): in/out land a little inside the movement, within 0.2 s", () => {
  const cos = (t: number) => STARTS.reduce((s, t0) => s + (t > t0 && t < t0 + REP_S ? (1 - Math.cos((2 * Math.PI * (t - t0)) / REP_S)) / 2 : 0), 0);
  const frames = series({ durationS: 20, y: (t) => 0.45 + 0.2 * cos(t), moving: ["hips", "knees"], noise: 0.002, seed: 7 });
  const { inErr, outErr } = assertClipped(findLift(frames, 5, "lower", 20), "hips", 5);
  assert.ok(inErr >= 0 && outErr <= 0, "never before the movement began or after it ended");
});

test("deadlift: reversed polarity (hips rise at lockout, y falls)", () => {
  const frames = series({ durationS: 20, y: reps5(0.6, -0.2), moving: ["hips", "knees"] });
  assertClipped(findLift(frames, 5, "lower", 20), "hips", 5);
});

test("bench: wrists", () => {
  const frames = series({ durationS: 20, y: reps5(0.35, 0.15), moving: ["wrists", "elbows"], visibility: { hips: 0.1, knees: 0.1 } });
  assertClipped(findLift(frames, 5, "upper", 20), "wrists", 5);
});

test("hips hidden: the knees are used for the whole series", () => {
  const frames = series({ durationS: 20, y: reps5(0.6, 0.08), moving: ["hips", "knees"], visibility: { hips: 0.2 } });
  assertClipped(findLift(frames, 5, "lower", 20), "knees", 5);
});

test("everything hidden, or no person found: low_confidence few_frames", () => {
  const hidden = series({ durationS: 20, y: reps5(0.45, 0.2), moving: ["hips", "knees"], visibility: { hips: 0.1, knees: 0.1 } });
  assert.deepEqual(findLift(hidden, 5, "lower", 20), { status: "low_confidence", reason: "few_frames" });
  const none = series({ durationS: 20, y: reps5(0.45, 0.2), moving: ["hips"], dropShare: 0.6, seed: 3 });
  assert.deepEqual(findLift(none, 5, "lower", 20), { status: "low_confidence", reason: "few_frames" });
  assert.deepEqual(findLift([], 5, "lower", 20), { status: "low_confidence", reason: "few_frames" });
});

test("a flat signal (< 3 % of the image height): low_confidence flat", () => {
  const frames = series({ durationS: 20, y: reps5(0.45, 0.01), moving: ["hips", "knees"], noise: 0.001 });
  assert.deepEqual(findLift(frames, 5, "lower", 20), { status: "low_confidence", reason: "flat" });
});

test("a walk-out bump before the first rep is not a rep", () => {
  const bump = (t: number) => (t > 0.5 && t < 1.7 ? 0.05 * Math.sin((Math.PI * (t - 0.5)) / 1.2) : 0);
  const frames = series({ durationS: 20, y: (t) => reps5(0.45, 0.2)(t) + bump(t), moving: ["hips", "knees"] });
  assertClipped(findLift(frames, 5, "lower", 20), "hips", 5);
});

test("a count off by 2 is low_confidence count; off by 1 still clips", () => {
  const frames = series({ durationS: 20, y: reps5(0.45, 0.2), moving: ["hips", "knees"] });
  assert.deepEqual(findLift(frames, 7, "lower", 20), { status: "low_confidence", reason: "count" });
  assert.deepEqual(findLift(frames, 3, "lower", 20), { status: "low_confidence", reason: "count" });
  assertClipped(findLift(frames, 6, "lower", 20), "hips", 5);
});

test("noise and dropped frames: still within 0.2 s", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const frames = series({ durationS: 20, y: reps5(0.45, 0.2), moving: ["hips", "knees"], noise: 0.004, dropShare: 0.1, seed });
    assertClipped(findLift(frames, 5, "lower", 20), "hips", 5);
  }
});

test("no expected reps, a rep too slow, in/out clamped to the clip", () => {
  const frames = series({ durationS: 20, y: reps5(0.45, 0.2), moving: ["hips", "knees"] });
  assert.deepEqual(findLift(frames, null, "lower", 20), { status: "low_confidence", reason: "no_reps" });
  // clip-auto-2: a 14 s rep found = expected is no longer rep_length; its edges are bounded to
  // OUTER_SPAN_ONE_REP_S of the peak (9 s), so in/out stay within that window plus the padding.
  const slow = (t: number) => 0.45 + 0.2 * Math.max(0, Math.sin((Math.PI * (t - 2)) / 14)) * (t > 2 && t < 16 ? 1 : 0);
  const slowResult = findLift(series({ durationS: 20, y: slow, moving: ["hips"] }), 1, "lower", 20);
  assert.equal(slowResult.status, "clipped");
  if (slowResult.status === "clipped") {
    assert.ok(slowResult.inS >= 9 - AUTO_CLIP.OUTER_SPAN_ONE_REP_S - AUTO_CLIP.PAD_S - 1e-9, `in ${slowResult.inS}`);
    assert.ok(slowResult.outS <= 9 + AUTO_CLIP.OUTER_SPAN_ONE_REP_S + AUTO_CLIP.PAD_S + 1e-9, `out ${slowResult.outS}`);
  }
  const early = series({ durationS: 17.5, y: reps5(0.45, 0.2, [0.2, 3, 6, 9, 12]), moving: ["hips"] });
  const r = findLift(early, 5, "lower", 17.5);
  assert.equal(r.status, "clipped");
  if (r.status === "clipped") assert.equal(r.inS, 0);
});

test("liftFamily: parent lift, else the sheet TYPE's lower-body words", () => {
  assert.equal(liftFamily("SQUAT"), "lower");
  assert.equal(liftFamily("QUADS/ADDUCTORS"), "lower");
  assert.equal(liftFamily("hamstrings"), "lower");
  assert.equal(liftFamily("BENCH"), "upper");
  assert.equal(liftFamily("CHEST/SHOULDERS"), "upper");
  assert.equal(liftFamily("LATS/MIDDLE BACK"), "upper");
  assert.equal(liftFamily("ACCESSORY", "Deadlift"), "lower");
  assert.equal(liftFamily(null, "bench"), "upper");
});

test("expectedReps: the log's reps_done, else the range top (reversed too), else a fixed count, else null", () => {
  assert.equal(expectedReps(6, "8 - 12"), 6);
  assert.equal(expectedReps(null, "8 - 12"), 12);
  assert.equal(expectedReps(null, "12 - 8"), 12);
  assert.equal(expectedReps(undefined, "5"), 5);
  assert.equal(expectedReps(0, "AMRAP"), null);
  assert.equal(expectedReps(null, null), null);
  assert.equal(expectedReps(2.5, "3"), 3);
});

test("the action's input: exactly five keys, never frames; the validation table", () => {
  const id = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
  const ok = { id, status: "clipped", inS: 2.34, outS: 9.06, runMs: 4100 };
  assert.deepEqual(parseSetClipAutoInput(ok), ok);
  assert.equal(parseSetClipAutoInput({ ...ok, frames: [] }), null, "landmarks or frames are refused");
  assert.equal(parseSetClipAutoInput({ ...ok, id: "nope" }), null);
  assert.equal(parseSetClipAutoInput({ id, status: "clipped", inS: 1, outS: 2 }), null);
  assert.equal(parseSetClipAutoInput([ok]), null);
  const v = (over: Record<string, unknown>, dur: number | null = 14.3) => validateClipAuto({ status: "clipped", inS: 1, outS: 3, runMs: 10, ...over }, dur);
  assert.deepEqual(v({ inS: 2.34, outS: 9.06 }), { status: "clipped", inS: 2.3, outS: 9.1, runMs: 10 });
  assert.deepEqual(v({ status: "low_confidence", inS: null, outS: null }), { status: "low_confidence", inS: null, outS: null, runMs: 10 });
  assert.deepEqual(v({ status: "failed", inS: null, outS: null, runMs: 0 }), { status: "failed", inS: null, outS: null, runMs: 0 });
  assert.deepEqual(v({ inS: 0, outS: 14.3, runMs: 3_600_000 }), { status: "clipped", inS: 0, outS: 14.3, runMs: 3_600_000 });
  for (const bad of [
    { status: "done" },
    { status: null },
    { status: "low_confidence" }, // in/out must be null unless clipped
    { status: "failed", inS: 1, outS: null },
    { inS: null, outS: null }, // clipped needs both
    { inS: 3, outS: 3 },
    { inS: 4, outS: 3 },
    { inS: -0.1 },
    { outS: 14.4 },
    { inS: Number.NaN },
    { outS: Number.POSITIVE_INFINITY },
    { inS: "1" },
    { runMs: -1 },
    { runMs: 3_600_001 },
    { runMs: 1.5 },
    { runMs: "10" },
  ]) {
    assert.equal(v(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(v({ outS: 99 }, null), { status: "clipped", inS: 1, outS: 99, runMs: 10 }, "the duration is checked when known");
});

/** A rep `k` times as long as repShape's (a grinder): same shape, stretched in time. */
const longRep = (t: number, t0: number, k: number) => repShape(t0 + (t - t0) / k, t0);
/** A walk-out at another standing height (y 0.40, swaying) until `until`, then 1 s to the rest level 0.45; the mirror after `from` (the re-rack). */
function walkOutAndRerack(until: number, from: number): (t: number) => number {
  return (t) => {
    const sway = 0.01 * Math.sin(2 * Math.PI * 0.8 * t);
    if (t < until) return 0.4 + sway;
    if (t < until + 1) return 0.4 + 0.05 * (t - until);
    if (t > from + 1) return 0.4 + sway;
    if (t > from) return 0.45 - 0.05 * (t - from);
    return 0.45;
  };
}

test("clip-auto-2: a 10 s walk-out at another height and a re-rack: in/out within 0.3 s", () => {
  const starts = [13, 16, 19, 22, 25];
  const base = walkOutAndRerack(10, 29);
  const y = (t: number) => base(t) + 0.2 * starts.reduce((s, t0) => s + repShape(t, t0), 0);
  const truth = { inS: starts[0] - AUTO_CLIP.PAD_S, outS: starts[4] + REP_S + AUTO_CLIP.PAD_S };
  for (const fps of [5, 10]) {
    const r = findLift(series({ durationS: 40, fps, y, moving: ["hips", "knees"], noise: 0.002, seed: 11 }), 5, "lower", 40);
    assert.equal(r.status, "clipped", JSON.stringify(r));
    if (r.status !== "clipped") continue;
    assert.ok(Math.abs(r.inS - truth.inS) <= 0.3 + 1e-9, `in ${r.inS} vs ${truth.inS} at ${fps} fps`);
    assert.ok(Math.abs(r.outS - truth.outS) <= 0.3 + 1e-9, `out ${r.outS} vs ${truth.outS} at ${fps} fps`);
  }
});

test("clip-auto-2: one rep after a walk-out and before a re-rack", () => {
  const base = walkOutAndRerack(3, 10);
  const y = (t: number) => base(t) + 0.2 * repShape(t, 6);
  const r = findLift(series({ durationS: 14, y, moving: ["hips", "knees"] }), 1, "lower", 14);
  assert.equal(r.status, "clipped", JSON.stringify(r));
  if (r.status === "clipped") {
    assert.ok(Math.abs(r.inS - 5.5) <= 0.3 + 1e-9, `in ${r.inS}`);
    assert.ok(Math.abs(r.outS - 8.7) <= 0.3 + 1e-9, `out ${r.outS}`);
  }
});

test("clip-auto-2: found = expected clips even with a rep 3× the others; off by 1 needs similar reps", () => {
  const y = (t: number) => 0.45 + 0.2 * (repShape(t, 3) + repShape(t, 6) + longRep(t, 9, 3) + repShape(t, 17) + repShape(t, 20));
  const frames = series({ durationS: 25, y, moving: ["hips", "knees"] });
  const truth = { inS: 3 - AUTO_CLIP.PAD_S, outS: 20 + REP_S + AUTO_CLIP.PAD_S };
  assertClipped(findLift(frames, 5, "lower", 25), "hips", 5, truth);
  assert.deepEqual(findLift(frames, 4, "lower", 25), { status: "low_confidence", reason: "rep_length" }, "off by 1 with a 3× outlier");
  assert.deepEqual(findLift(frames, 6, "lower", 25), { status: "low_confidence", reason: "rep_length" });
  const even = series({ durationS: 20, y: reps5(0.45, 0.2), moving: ["hips", "knees"] });
  assertClipped(findLift(even, 4, "lower", 20), "hips", 5);
  assertClipped(findLift(even, 6, "lower", 20), "hips", 5);
  const trace = diagnoseLift(frames, 5, "lower", 25).trace;
  assert.equal(trace.repLengths?.length, 5);
  assert.ok(trace.repLengths !== null && Math.abs(trace.repLengths[2] / trace.repLengths[0] - 3) < 0.3, JSON.stringify(trace.repLengths));
  assert.ok(trace.reps !== null && trace.reps.every((r) => r.start < r.peak && r.peak < r.end));
  assert.equal(ALGO_VERSION, 3);
});

test("diagnoseLift follows findLift: the same status and reason on every synthetic series", () => {
  const cases: [PoseFrame[], number | null, "lower" | "upper", number][] = [
    [series({ durationS: 20, y: reps5(0.45, 0.2), moving: ["hips", "knees"] }), 5, "lower", 20],
    [series({ durationS: 20, y: reps5(0.6, -0.2), moving: ["hips", "knees"] }), 5, "lower", 20],
    [series({ durationS: 20, y: reps5(0.35, 0.15), moving: ["wrists", "elbows"], visibility: { hips: 0.1, knees: 0.1 } }), 5, "upper", 20],
    [series({ durationS: 20, y: reps5(0.6, 0.08), moving: ["hips", "knees"], visibility: { hips: 0.2 } }), 5, "lower", 20],
    [series({ durationS: 20, y: reps5(0.45, 0.2), moving: ["hips", "knees"], visibility: { hips: 0.1, knees: 0.1 } }), 5, "lower", 20],
    [series({ durationS: 20, y: reps5(0.45, 0.2), moving: ["hips"], dropShare: 0.6, seed: 3 }), 5, "lower", 20],
    [series({ durationS: 20, y: reps5(0.45, 0.01), moving: ["hips", "knees"], noise: 0.001 }), 5, "lower", 20],
    [series({ durationS: 20, y: reps5(0.45, 0.2), moving: ["hips", "knees"] }), 7, "lower", 20],
    [series({ durationS: 20, y: reps5(0.45, 0.2), moving: ["hips", "knees"] }), null, "lower", 20],
    [[], 5, "lower", 20],
  ];
  for (const [frames, expected, family, d] of cases) {
    const diag = diagnoseLift(frames, expected, family, d);
    assert.deepEqual(diag.result, findLift(frames, expected, family, d));
    assert.equal(diag.frames, frames.length);
  }
  const [squat] = cases[0];
  const diag = diagnoseLift(squat, 5, "lower", 20);
  assert.equal(diag.personShare, 1);
  assert.equal(diag.trace.joint, "hips");
  assert.equal(diag.trace.validShare, 1);
  assert.ok(diag.trace.range !== null && diag.trace.range > 0.1);
  assert.equal(diag.trace.chosenSign, 1);
  assert.equal(diag.trace.peaksUp, 5);
  assert.ok(Math.abs((diag.visibility.hips.l ?? 0) - 0.9) < 1e-9 && Math.abs((diag.visibility.shoulders.r ?? 0) - 0.9) < 1e-9);
  const flat = diagnoseLift(cases[6][0], 5, "lower", 20);
  assert.deepEqual(flat.result, { status: "low_confidence", reason: "flat" });
  assert.equal(flat.trace.peaksUp, null, "steps after the failing rule are not reached");
  const hidden = diagnoseLift(cases[4][0], 5, "lower", 20);
  assert.ok(hidden.trace.validShare !== null && hidden.trace.validShare < AUTO_CLIP.VALID_MIN_SHARE);
  assert.equal(diagnoseLift([], 5, "lower", 20).personShare, null);
});
