import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { chooseMode } from "../src/lib/video/auto-run.ts";
import { fileFacts, keyframeTimes } from "../src/lib/video/cut.ts";

// Real producer output: Chrome's MediaRecorder (fake camera, video/mp4;codecs=avc1), 12 s, recorded
// WITHOUT videoKeyFrameIntervalDuration, as an older phone build or a browser ignoring the option would.
const DEFAULT_12S = new Blob([new Uint8Array(readFileSync(new URL("./fixtures/video/fake-default-12s.mp4", import.meta.url)))]);
// The same recorder WITH the 1 s keyframe option.
const KF = new Blob([new Uint8Array(readFileSync(new URL("./fixtures/video/fake-kf.mp4", import.meta.url)))]);

test("a >10 s clip recorded without the keyframe option gets play mode from analyseClip's rule", async () => {
  const facts = await fileFacts(DEFAULT_12S);
  assert.ok(facts.durationS > 10, `duration ${facts.durationS}`);
  const kf = await keyframeTimes(DEFAULT_12S);
  const choice = chooseMode(kf, facts.durationS);
  assert.equal(choice.mode, "play", `keyframes ${JSON.stringify(kf)} → ${JSON.stringify(choice)}`);
  assert.match(choice.keyframes ?? "", /^nøglebilleder op til \d+,\d s$/, "the keyframe fact uses a comma decimal");
});

test("the keyframe-option clip plays too since clip-auto-3 (seek is only the fallback)", async () => {
  const facts = await fileFacts(KF);
  const choice = chooseMode(await keyframeTimes(KF), facts.durationS);
  assert.equal(choice.mode, "play");
  assert.equal(choice.why, "afspil");
});
