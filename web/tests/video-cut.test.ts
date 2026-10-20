import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createFile, MP4BoxBuffer } from "mp4box";

import { CutError, cutMp4, cutRange, keyframeTimes } from "../src/lib/video/cut.ts";

// Chrome's fake-camera test pattern, recorded with a keyframe every second (no personal data).
const FIXTURE = new Uint8Array(readFileSync(new URL("./fixtures/video/fake-kf.mp4", import.meta.url)));
const fixture = () => new Blob([FIXTURE], { type: "video/mp4" });

type Read = { top: string[]; mvex: boolean; timescale: number; duration: number; samples: { dts: number; cts: number; duration: number; sync: boolean; bytes: Uint8Array }[] };

/** Reads every video sample with its bytes (the test's own parse, independent of cut.ts). */
function read(u8: Uint8Array): Read {
  const f = createFile();
  let id = -1;
  const got: Read["samples"] = [];
  f.onReady = (info) => {
    id = info.videoTracks[0].id;
    f.setExtractionOptions(id, null, { nbSamples: 1e6 });
    f.start();
  };
  f.onSamples = (_id, _user, ss) => {
    for (const s of ss) got.push({ dts: s.dts, cts: s.cts, duration: s.duration, sync: s.is_sync, bytes: new Uint8Array(s.data ?? new Uint8Array()) });
  };
  f.appendBuffer(MP4BoxBuffer.fromArrayBuffer(u8.slice().buffer, 0));
  f.flush();
  const trak = f.getTrackById(id);
  return { top: (f.boxes ?? []).map((b) => b.type), mvex: f.moov?.mvex !== undefined, timescale: trak.mdia.mdhd.timescale, duration: trak.mdia.mdhd.duration, samples: got };
}

test("cutting 1.3–2.6 s gives a plain MP4 that starts on the keyframe before in and ends before out", async () => {
  const src = read(FIXTURE);
  const out = new Uint8Array(await (await cutMp4(fixture(), 1.3, 2.6)).arrayBuffer());
  const cut = read(out);
  assert.ok(!cut.top.includes("moof"), `top boxes ${cut.top.join(",")}`);
  assert.equal(cut.mvex, false);
  assert.deepEqual(cut.top, ["ftyp", "moov", "mdat"]);

  const first = cut.samples[0];
  assert.equal(first.sync, true);
  assert.equal(first.dts, 0);
  assert.equal(first.cts, 0);
  // Its place in the source: identical bytes; 0–1.05 s before in.
  const srcIndex = src.samples.findIndex((s) => s.sync && Buffer.from(s.bytes).equals(Buffer.from(first.bytes)));
  assert.ok(srcIndex >= 0);
  const srcStart = src.samples[srcIndex].cts / src.timescale;
  assert.ok(1.3 - srcStart >= 0 && 1.3 - srcStart <= 1.05, `source start ${srcStart}`);

  const last = cut.samples[cut.samples.length - 1];
  assert.ok(srcStart + last.cts / cut.timescale < 2.6, "the last sample starts before out");
  const next = src.samples[srcIndex + cut.samples.length];
  assert.ok(next === undefined || next.cts / src.timescale >= 2.6, "every sample before out is kept");

  assert.equal(cut.duration, cut.samples.reduce((a, s) => a + s.duration, 0));
  cut.samples.forEach((s, i) => {
    const o = src.samples[srcIndex + i];
    assert.ok(Buffer.from(s.bytes).equals(Buffer.from(o.bytes)), `sample ${i} bytes`);
    assert.equal(s.sync, o.sync);
    assert.equal(s.duration, o.duration);
  });
});

test("a truncated copy, garbage and a range outside the clip throw CutError", async () => {
  const half = new Blob([FIXTURE.slice(0, Math.floor(FIXTURE.length / 2))]);
  await assert.rejects(cutMp4(half, 1.3, 2.6), (e) => e instanceof CutError && e.reason === "truncated");
  const junk = new Blob([new Uint8Array(50_000).map((_, i) => (i * 7919) % 251)]);
  await assert.rejects(cutMp4(junk, 1.3, 2.6), (e) => e instanceof CutError && e.reason === "not_mp4");
  await assert.rejects(cutMp4(fixture(), 10, 12), (e) => e instanceof CutError && e.reason === "empty_range");
  await assert.rejects(cutMp4(fixture(), 2, 2), (e) => e instanceof CutError && e.reason === "empty_range");
  await assert.rejects(keyframeTimes(junk), CutError);
});

test("the fixture's keyframes are at most 1.1 s apart", async () => {
  const kf = await keyframeTimes(fixture());
  assert.ok(kf.length >= 3);
  assert.equal(kf[0], 0);
  const gap = Math.max(...kf.slice(1).map((t, i) => t - kf[i]));
  assert.ok(gap <= 1.1, `max gap ${gap}`);
});

test("cutRange: the user's points win, then clipped auto points, else none; WebM never", () => {
  const none = { clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null } as const;
  const cases: [string, Parameters<typeof cutRange>[0], "mp4" | "webm", ReturnType<typeof cutRange>][] = [
    ["nothing", none, "mp4", { reason: "none", range: null }],
    ["user", { ...none, clipInS: 1, clipOutS: 5 }, "mp4", { reason: "user", range: { inS: 1, outS: 5 } }],
    ["user beats auto", { clipInS: 1, clipOutS: 5, autoInS: 2, autoOutS: 4, autoStatus: "clipped" }, "mp4", { reason: "user", range: { inS: 1, outS: 5 } }],
    ["auto clipped", { ...none, autoInS: 2, autoOutS: 4, autoStatus: "clipped" }, "mp4", { reason: "auto", range: { inS: 2, outS: 4 } }],
    ["auto low_confidence", { ...none, autoStatus: "low_confidence" }, "mp4", { reason: "none", range: null }],
    ["auto failed", { ...none, autoStatus: "failed" }, "mp4", { reason: "none", range: null }],
    ["auto 0 is a real in point", { ...none, autoInS: 0, autoOutS: 4, autoStatus: "clipped" }, "mp4", { reason: "auto", range: { inS: 0, outS: 4 } }],
    ["webm with points", { clipInS: 1, clipOutS: 5, autoInS: 2, autoOutS: 4, autoStatus: "clipped" }, "webm", { reason: "webm", range: null }],
  ];
  for (const [name, row, ext, want] of cases) assert.deepEqual(cutRange(row, ext), want, name);
});
