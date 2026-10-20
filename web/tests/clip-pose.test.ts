import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CONTENT_SECURITY_POLICY, MEDIAPIPE_CACHE, PERMISSIONS_POLICY } from "../next.config.ts";
import { REQUIRED_WASM, copyWasm } from "../scripts/copy-mediapipe.mjs";
import { jointsSeenShare, poseLine, poseReason } from "../src/lib/video/camera-diag.ts";
import { MEDIAPIPE_VERSION, MODEL_PATH, PoseError, WASM_BASE, frameTimes } from "../src/lib/video/pose-run.ts";

const WEB = join(import.meta.dirname, "..");

// Slice clip-pose (2026-10-20): the committed model is the pinned float16 v1 file, unmodified.
const MODEL_SHA256 = "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a";

test("the committed pose model is the pinned file, at its source URL's versioned path", () => {
  assert.equal(MODEL_PATH, "/mediapipe/models/pose_landmarker_lite/float16/1/pose_landmarker_lite.task");
  const bytes = readFileSync(join(WEB, "public", MODEL_PATH));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), MODEL_SHA256);
  const notice = readFileSync(join(WEB, "public/mediapipe/models/pose_landmarker_lite/float16/1/NOTICE"), "utf8");
  assert.match(notice, /Apache License, Version 2\.0/);
  assert.ok(notice.includes(`https://storage.googleapis.com/mediapipe-models/pose_landmarker${MODEL_PATH.slice("/mediapipe/models".length)}`));
});

test("the runner's version is the installed package's, and its paths stay on this origin", () => {
  const pkg = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  assert.equal(pkg.dependencies["@mediapipe/tasks-vision"], MEDIAPIPE_VERSION);
  assert.equal(WASM_BASE, `/mediapipe/${MEDIAPIPE_VERSION}/wasm`);
  for (const path of [WASM_BASE, MODEL_PATH]) assert.match(path, /^\/mediapipe\//);
});

test("CSP and Permissions-Policy are byte-identical to before clip-pose (no script-src: WASM may run; connect-src 'self' blocks MediaPipe's usage logger to odml.pa.googleapis.com)", () => {
  assert.equal(
    CONTENT_SECURITY_POLICY,
    "frame-ancestors 'none'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'",
    "connect-src 'self' is what blocks MediaPipe's built-in usage logger (POST https://odml.pa.googleapis.com/v1/log); never loosen it",
  );
  assert.equal(PERMISSIONS_POLICY, "camera=(self), microphone=(), geolocation=(), display-capture=()");
  assert.equal(MEDIAPIPE_CACHE, "public, max-age=31536000, immutable");
});

test("the copy script is idempotent: a second run copies nothing and changes no file", () => {
  const from = mkdtempSync(join(tmpdir(), "mp-from-"));
  const to = join(mkdtempSync(join(tmpdir(), "mp-to-")), "1.1.0", "wasm");
  const required = ["a.js", "a.wasm"];
  try {
    writeFileSync(join(from, "a.wasm"), Buffer.from([0, 97, 115, 109]));
    writeFileSync(join(from, "a.js"), "x");
    assert.deepEqual(copyWasm(from, to, required), ["a.js", "a.wasm"]);
    const mtimes = readdirSync(to).map((n) => statSync(join(to, n)).mtimeMs);
    assert.deepEqual(copyWasm(from, to, required), []);
    assert.deepEqual(readdirSync(to).map((n) => statSync(join(to, n)).mtimeMs), mtimes);
    writeFileSync(join(from, "a.js"), "y"); // a changed source file is copied again
    assert.deepEqual(copyWasm(from, to, required), ["a.js"]);
    assert.equal(readFileSync(join(to, "a.js"), "utf8"), "y");
  } finally {
    rmSync(from, { recursive: true, force: true });
    rmSync(join(to, "..", ".."), { recursive: true, force: true });
  }
});

test("the copy script fails loudly when the package's vision_wasm_* files are missing, never 'up to date'", () => {
  const from = mkdtempSync(join(tmpdir(), "mp-empty-"));
  const to = join(mkdtempSync(join(tmpdir(), "mp-to-")), "wasm");
  try {
    assert.throws(() => copyWasm(from, to), /mangler vision_wasm_internal\.js/);
    writeFileSync(join(from, "vision_wasm_internal.js"), "x");
    assert.throws(() => copyWasm(from, to), /vision_wasm_nosimd_internal\.wasm/);
    assert.throws(() => copyWasm(join(from, "nope"), to), /mangler/);
    assert.ok(REQUIRED_WASM.every((n) => readdirSync(join(WEB, "node_modules/@mediapipe/tasks-vision/wasm")).includes(n)));
  } finally {
    rmSync(from, { recursive: true, force: true });
    rmSync(join(to, ".."), { recursive: true, force: true });
  }
});

test("frame times are i / fps from 0, stop before the duration, and refuse a bad fps", () => {
  assert.deepEqual(frameTimes(1, 5), [0, 0.2, 0.4, 0.6, 0.8]);
  // A running sum of 1/3 reaches 1.9999999999999998 < 2 and adds a 7th frame at the clip's end.
  assert.deepEqual(frameTimes(2, 3), [0, 0.333, 0.667, 1, 1.333, 1.667]);
  const long = frameTimes(60, 30);
  assert.equal(long.length, 1800);
  assert.equal(long[1799], 59.967);
  assert.equal(long[900], 30);
  assert.deepEqual(frameTimes(0, 5), []);
  for (const fps of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => frameTimes(1, fps), PoseError);
});

const SEEN: [number, number, number] = [0.5, 0.5, 0.9];
const UNSEEN: [number, number, number] = [0.5, 0.5, 0.2];
function person(visibleAt: number | null): [number, number, number][] {
  return Array.from({ length: 33 }, (_, i) => (i === visibleAt ? SEEN : UNSEEN));
}

test("joints seen: a frame counts with ≥ 1 hip, knee, wrist or elbow at visibility ≥ 0.5", () => {
  assert.equal(jointsSeenShare([]), null);
  // nose (0) and an ankle (27) don't count; a knee (25) and a wrist (15) do; no person doesn't.
  assert.equal(jointsSeenShare([{ landmarks: person(0) }, { landmarks: person(27) }, { landmarks: person(25) }, { landmarks: null }]), 0.25);
  assert.equal(jointsSeenShare([{ landmarks: person(15) }, { landmarks: person(23) }]), 1);
  const edge = person(null);
  edge[13] = [0.1, 0.1, 0.5];
  assert.equal(jointsSeenShare([{ landmarks: edge }]), 1);
});

test("the pose line uses Danish numbers (decimal comma, cut-lines' seconds)", () => {
  assert.equal(
    poseLine({ ok: true, timing: { loadMs: 2140, frames: 20, msPerFrame: 70.4, totalMs: 1449 }, seenShare: 0.85 }),
    "Pose: 20 billeder på 1,4 s (70 ms pr. billede, indlæsning 2,1 s) · led set i 85 % af billederne (hofte, knæ, håndled eller albue)",
  );
  assert.equal(
    poseLine({ ok: true, timing: { loadMs: 950, frames: 1, msPerFrame: 33, totalMs: 40 }, seenShare: 0 }),
    "Pose: 1 billede på 0,0 s (33 ms pr. billede, indlæsning 1,0 s) · led set i 0 % af billederne (hofte, knæ, håndled eller albue)",
  );
  assert.equal(poseLine({ ok: false, reason: "afbrudt" }), "Pose kunne ikke køre (afbrudt)");
});

test("a failure's reason is short and never a stack", () => {
  assert.equal(poseReason(new PoseError("timeout", "over 90 s")), "over 90 s");
  assert.equal(poseReason(new TypeError("Failed to fetch")), "TypeError: Failed to fetch");
  const long = poseReason(new Error("x".repeat(200)));
  assert.equal(long.length, 60);
  assert.ok(long.endsWith("…"));
});
