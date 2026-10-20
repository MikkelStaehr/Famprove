import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { diagnoseLift } from "../src/lib/video/auto-clip.ts";
import { fileFacts, matrixRotation } from "../src/lib/video/cut.ts";
import { debugLog, frameCheck } from "../src/lib/video/debug-log.ts";
import { type PosePoint, seekTiming } from "../src/lib/video/pose-run.ts";

const FIXTURE = new Uint8Array(readFileSync(new URL("./fixtures/video/fake-kf.mp4", import.meta.url)));
const F = 65536;

test("matrixRotation: the tkhd matrix's quarter turns, else null", () => {
  assert.equal(matrixRotation([F, 0, 0, 0, F, 0, 0, 0, 0x40000000]), 0);
  assert.equal(matrixRotation([0, F, 0, -F, 0, 0, 0, 0, 0x40000000]), 90);
  assert.equal(matrixRotation([-F, 0, 0, 0, -F, 0, 0, 0, 0x40000000]), 180);
  assert.equal(matrixRotation([0, -F, 0, F, 0, 0, 0, 0, 0x40000000]), 270);
  assert.equal(matrixRotation([F, F, 0, -F, F, 0, 0, 0, 0x40000000]), null);
  assert.equal(matrixRotation([0, 0, 0, 0, 0, 0, 0, 0, 0]), null);
});

test("fileFacts on the fixture: 0°, its coded size and its keyframes", async () => {
  const f = await fileFacts(new Blob([FIXTURE], { type: "video/mp4" }));
  assert.equal(f.rotation, 0);
  assert.ok(f.codedWidth > 0 && f.codedHeight > 0);
  assert.ok(f.keyframes >= 1);
  assert.ok(f.maxKeyframeGapS !== null && f.maxKeyframeGapS > 0 && f.maxKeyframeGapS <= f.durationS + 1e-9);
});

test("seekTiming: count, mean, max and where the max was", () => {
  assert.deepEqual(seekTiming([]), { count: 0, meanMs: 0, maxMs: 0, maxAt: null });
  assert.deepEqual(seekTiming([10, 30, 5000, 20]), { count: 4, meanMs: 1265, maxMs: 5000, maxAt: 2 });
});

test("frameCheck: no person, else mean hip and knee visibility", () => {
  assert.deepEqual(frameCheck(null), { person: false, hip: null, knee: null });
  const pts: PosePoint[] = Array.from({ length: 33 }, (_, i) => [0.5, 0.5, i === 23 ? 0.2 : i === 24 ? 0.4 : 0.8] as const);
  const c = frameCheck(pts);
  assert.equal(c.person, true);
  assert.ok(Math.abs((c.hip ?? 0) - 0.3) < 1e-9 && Math.abs((c.knee ?? 0) - 0.8) < 1e-9);
});

test("debugLog: aggregates and steps, never landmarks", () => {
  const frames = Array.from({ length: 10 }, (_, i) => ({ t: i / 5, landmarks: i < 3 ? null : (Array.from({ length: 33 }, () => [0.123456, 0.654321, 0.9] as const) as PosePoint[]) }));
  const log = debugLog({
    clip: { label: "Squat, sæt 2", status: "failed", durationS: 12.34, family: "lower", expected: 5 },
    facts: { rotation: 90, codedWidth: 1280, codedHeight: 720, keyframes: 2, maxKeyframeGapS: 9.5, durationS: 12.3 },
    videoSize: { w: 720, h: 1280 },
    runs: [
      { mode: "seek", ok: false, step: "video", message: "seeked kom ikke inden for 5 s", reached: { done: 41, of: 62, seek: seekTiming([100, 5000]) }, ms: 43000 },
      { mode: "play", ok: true, diag: diagnoseLift(frames, 5, "lower", 2), seek: null, ms: 12500 },
    ],
    images: [{ pct: 50, t: 6.2, video: { person: true, hip: 0.91, knee: 0.5 }, canvas: { person: false, hip: null, knee: null } }],
    reanalyse: "failed (video: seeked kom ikke inden for 5 s) · gemt ja",
  });
  for (const line of [
    "klip: Squat, sæt 2 · status failed · længde 12.3 s · lower · forventet 5 reps",
    "fil: rotation 90° · kodet 1280×720 · 12.3 s",
    "keyframes: 2 · største afstand 9.5 s",
    "<video>: 720×1280",
    "fejlede i trin: video",
    "fejl: seeked kom ikke inden for 5 s",
    "nåede billede 41 af 62",
    "seek: 2 · snit 2550 ms · max 5000 ms (billede 1)",
    "billeder: 10 · person fundet: 70 %",
    "hofte L 0.90 R 0.90",
    "led: hips · gyldige: 70 %",
    "udsving p5–p95: 0 % af billedhøjden",
    "resultat: low_confidence: flat",
    "billede 50 % (6.2 s): video person ja · hofte 0.91 · knæ 0.50 | canvas person nej · hofte – · knæ –",
    "analysér igen: failed (video: seeked kom ikke inden for 5 s) · gemt ja",
  ])
    assert.ok(log.split("\n").includes(line), `missing: ${line}\n${log}`);
  assert.ok(!log.includes("0.123") && !log.includes("0.654"), "no landmark coordinates in the log");
});
