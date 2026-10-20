import assert from "node:assert/strict";
import { test } from "node:test";

import { type CameraResult, diagResources, errorText, formatReport, formatValue, otherKeys, pickDiag, settingsLine, zoomMinOf } from "../src/lib/video/camera-diag.ts";

const CAPS = {
  deviceId: "secret-device",
  groupId: "secret-group",
  width: { min: 1, max: 4000, step: 1 },
  height: { min: 1, max: 3000 },
  aspectRatio: { min: 0.00025, max: 4000 },
  frameRate: { min: 1, max: 30 },
  zoom: { min: 0.6, max: 10, step: 0.1 },
  facingMode: ["environment"],
  resizeMode: ["none", "crop-and-scale"],
  torch: true,
  focusMode: ["continuous"],
};

const SETTINGS = { deviceId: "secret-device", groupId: "secret-group", width: 960, height: 720, aspectRatio: 1.3333333, frameRate: 30, zoom: 0.6, facingMode: "environment", resizeMode: "none" };

const CAMERA: CameraResult = {
  index: 1,
  label: "camera2 0, facing back",
  open: { ok: true, settings: pickDiag({ ...SETTINGS, width: 640, height: 480, zoom: 1 }) },
  capabilities: pickDiag(CAPS),
  otherCapabilities: otherKeys(CAPS),
  tries: [
    { name: "960×720 (4:3)", outcome: { ok: true, settings: pickDiag(SETTINGS) } },
    { name: "1280×720", outcome: { ok: false, error: errorText(Object.assign(new Error("no fit"), { name: "OverconstrainedError" })) } },
  ],
  zoomMin: { ok: true, settings: pickDiag(SETTINGS) },
  shot: { width: 960, height: 720 },
};

test("camera-diag: deviceId and groupId are never kept, shown or copied", () => {
  const picked = pickDiag(CAPS) as Record<string, unknown>;
  assert.equal("deviceId" in picked, false);
  assert.equal("groupId" in picked, false);
  assert.deepEqual(otherKeys(CAPS), ["focusMode", "torch"]);
  const text = formatReport([CAMERA], new Date("2026-10-20T08:00:00Z"));
  assert.doesNotMatch(text, /secret|deviceId|groupId/);
});

test("camera-diag: values format as ranges, lists and short numbers", () => {
  assert.equal(formatValue({ min: 0.6, max: 10, step: 0.1 }), "0.6–10 (trin 0.1)");
  assert.equal(formatValue({ min: 1, max: 30 }), "1–30");
  assert.equal(formatValue(["none", "crop-and-scale"]), "none, crop-and-scale");
  assert.equal(formatValue([]), "–");
  assert.equal(formatValue(1.3333333), "1.333");
  assert.equal(settingsLine(pickDiag(SETTINGS)), "960×720 · 4:3 (1.333) · 30 fps · zoom 0.6 · environment · resize none");
  assert.equal(settingsLine({}), "ingen indstillinger");
  assert.equal(zoomMinOf(pickDiag(CAPS)), 0.6);
  assert.equal(zoomMinOf(pickDiag({ width: { min: 1, max: 2 } })), null);
  assert.equal(zoomMinOf(null), null);
});

test("camera-diag: the report has a header and one block per camera, errors as name: message", () => {
  const text = formatReport([CAMERA, { ...CAMERA, index: 2, label: "", capabilities: null, otherCapabilities: [], zoomMin: null, shot: { error: "AbortError: stop" } }], new Date("2026-10-20T08:00:00Z"));
  assert.equal(
    text,
    [
      "Kameratest · 2026-10-20 08:00 UTC · 2 kameraer",
      "",
      "Kamera 1 · camera2 0, facing back",
      "  Åbnet: 640×480 · 4:3 (1.333) · 30 fps · zoom 1 · environment · resize none",
      "  Kan:",
      "    width: 1–4000 (trin 1)",
      "    height: 1–3000",
      "    aspectRatio: 0–4000",
      "    frameRate: 1–30",
      "    zoom: 0.6–10 (trin 0.1)",
      "    facingMode: environment",
      "    resizeMode: none, crop-and-scale",
      "    andet: focusMode, torch",
      "  960×720 (4:3): 960×720 · 4:3 (1.333) · 30 fps · zoom 0.6 · environment · resize none",
      "  1280×720: fejl · OverconstrainedError: no fit",
      "  Zoom min: 960×720 · 4:3 (1.333) · 30 fps · zoom 0.6 · environment · resize none",
      "  Testbillede: 960×720",
      "",
      "Kamera 2 · (intet navn)",
      "  Åbnet: 640×480 · 4:3 (1.333) · 30 fps · zoom 1 · environment · resize none",
      "  Kan: getCapabilities findes ikke",
      "  960×720 (4:3): 960×720 · 4:3 (1.333) · 30 fps · zoom 0.6 · environment · resize none",
      "  1280×720: fejl · OverconstrainedError: no fit",
      "  Zoom min: zoom understøttes ikke",
      "  Testbillede: fejl · AbortError: stop",
    ].join("\n"),
  );
  assert.equal(formatReport([], new Date("2026-10-20T08:00:00Z")), "Kameratest · 2026-10-20 08:00 UTC · 0 kameraer");
});

function track() {
  const t = { stopped: 0, stop: () => void (t.stopped += 1) };
  return t;
}

test("camera-diag lifecycle: stopTracks closes the open camera, release stops and revokes everything", () => {
  const revoked: string[] = [];
  const res = diagResources((u) => revoked.push(u));
  const a = track();
  assert.equal(res.addTracks([a]), true);
  res.stopTracks(); // before the next camera opens
  assert.equal(a.stopped, 1);
  const b = track();
  res.addTracks([b]);
  assert.equal(res.addUrl("blob:1"), true);
  res.addUrl("blob:2");
  res.release(); // unmount, page hidden or back
  assert.equal(a.stopped, 1, "a stopped track is not stopped again");
  assert.equal(b.stopped, 1);
  assert.deepEqual(revoked, ["blob:1", "blob:2"]);
  assert.equal(res.released, true);
  res.release(); // twice is harmless
  assert.deepEqual(revoked, ["blob:1", "blob:2"]);
  assert.equal(b.stopped, 1);
});

test("camera-diag lifecycle: a camera or shot arriving after release is closed at once", () => {
  const revoked: string[] = [];
  const res = diagResources((u) => revoked.push(u));
  res.release();
  const late = track();
  assert.equal(res.addTracks([late]), false);
  assert.equal(late.stopped, 1);
  assert.equal(res.addUrl("blob:late"), false);
  assert.deepEqual(revoked, ["blob:late"]);
});
