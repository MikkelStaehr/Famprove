// Tester's proof of slice clip-cut (design/specs/clip-cut.md §Acceptance), on the real cut of the
// fake-camera fixture: the done line's actual range, the original left alone, failure and WebM
// fallbacks, no network, comma decimals, and seeded random ranges against an independent parse.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createFile, MP4BoxBuffer } from "mp4box";

import { parseVideoClipRow } from "../src/lib/db/rows.ts";
import { CutError, cutClip, cutRange, keyframeTimes } from "../src/lib/video/cut.ts";
import { cutLine, formatRange, formatSeconds, keyframeLines, prepareClip, saveDoneLine, shareCutLine } from "../src/lib/video/cut-lines.ts";

const FIXTURE = new Uint8Array(readFileSync(new URL("./fixtures/video/fake-kf.mp4", import.meta.url)));
const NAME = "2026-10-19 Squat sæt 2.mp4";
const NONE = { clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null } as const;
const sha = (u8: Uint8Array) => createHash("sha256").update(u8).digest("hex");

type Sample = { cts: number; dts: number; duration: number; sync: boolean; bytes: Buffer };
/** An independent parse of every video sample (not cut.ts's). */
function read(u8: Uint8Array): { timescale: number; duration: number; samples: Sample[] } {
  const f = createFile();
  let id = -1;
  const got: Sample[] = [];
  f.onReady = (info) => {
    id = info.videoTracks[0].id;
    f.setExtractionOptions(id, null, { nbSamples: 1e6 });
    f.start();
  };
  f.onSamples = (_id, _u, ss) => {
    for (const s of ss) got.push({ cts: s.cts, dts: s.dts, duration: s.duration, sync: s.is_sync, bytes: Buffer.from(s.data ?? new Uint8Array()) });
  };
  f.appendBuffer(MP4BoxBuffer.fromArrayBuffer(u8.slice().buffer, 0));
  f.flush();
  const trak = f.getTrackById(id);
  return { timescale: trak.mdia.mdhd.timescale, duration: trak.mdia.mdhd.duration, samples: got };
}

const SRC = read(FIXTURE);
const maxGap = (kf: number[]) => Math.max(...kf.slice(1).map((t, i) => t - kf[i]));

test("Gem on a cut MP4: name ends ' klippet.mp4' and the done line's range is the cut file's measured start and end", async () => {
  const kf = await keyframeTimes(new Blob([FIXTURE]));
  const range = cutRange({ ...NONE, clipInS: 1.3, clipOutS: 2.6 }, "mp4");
  const p = await prepareClip(new Blob([FIXTURE], { type: "video/mp4" }), NAME, range, cutClip);
  assert.equal(p.kind, "cut");
  if (p.kind !== "cut") return;
  assert.ok(p.name.endsWith(" klippet.mp4"), p.name);
  // Measure the cut file itself and locate its first sample in the source by bytes.
  const cut = read(new Uint8Array(await p.blob.arrayBuffer()));
  const at = SRC.samples.findIndex((s) => s.sync && s.bytes.equals(cut.samples[0].bytes));
  assert.ok(at >= 0);
  const startS = SRC.samples[at].cts / SRC.timescale;
  const endS = startS + cut.duration / cut.timescale;
  assert.ok(Math.abs(p.actual.startS - startS) < 1e-9, `actual start ${p.actual.startS} vs measured ${startS}`);
  assert.ok(Math.abs(p.actual.endS - endS) < 1e-9, `actual end ${p.actual.endS} vs measured ${endS}`);
  assert.ok(startS <= 1.3 && 1.3 - startS <= maxGap(kf), `start ${startS}, largest gap ${maxGap(kf)}`);
  assert.equal(saveDoneLine(p), `Sendt til Downloads som 2026-10-19 Squat sæt 2 klippet.mp4 · ${formatRange(startS, endS)}.`);
  assert.doesNotMatch(saveDoneLine(p), /\d\.\d/);
});

test("cutting leaves the original Blob's bytes unchanged and copies the kept samples byte for byte", async () => {
  const before = sha(FIXTURE);
  const orig = new Blob([FIXTURE], { type: "video/mp4" });
  const { blob } = await cutClip(orig, 0.4, 3.1);
  assert.equal(orig.size, FIXTURE.length);
  assert.equal(sha(new Uint8Array(await orig.arrayBuffer())), before);
  assert.equal(sha(FIXTURE), before);
  const cut = read(new Uint8Array(await blob.arrayBuffer()));
  const at = SRC.samples.findIndex((s) => s.sync && s.bytes.equals(cut.samples[0].bytes));
  cut.samples.forEach((s, i) => assert.ok(s.bytes.equals(SRC.samples[at + i].bytes), `sample ${i}`));
});

test("WebM, no range and a real failed cut give the original's bytes unchanged and the right line", async () => {
  const orig = new Blob([FIXTURE], { type: "video/mp4" });
  const webm = cutRange({ clipInS: 1, clipOutS: 2, autoInS: 1, autoOutS: 2, autoStatus: "clipped" }, "webm");
  assert.equal(cutLine(webm), "Kan ikke klippes på denne telefon. Gem og Del giver hele videoen.");
  const pw = await prepareClip(orig, "2026-10-19 Squat sæt 2.webm", webm, cutClip);
  assert.equal(pw.kind, "whole");
  assert.equal(pw.blob, orig);
  assert.equal(saveDoneLine(pw), "Sendt til Downloads som 2026-10-19 Squat sæt 2.webm.");

  const none = await prepareClip(orig, NAME, cutRange(NONE, "mp4"), cutClip);
  assert.equal(none.kind, "whole");
  assert.equal(none.blob, orig);
  assert.equal(cutLine(cutRange(NONE, "mp4")), null);

  // A truncated file (the real cut throws CutError) and a range past the end both fall back whole.
  for (const [blob, inS, outS] of [[new Blob([FIXTURE.slice(0, 120_000)]), 1.3, 2.6], [orig, 50, 60]] as const) {
    const before = sha(new Uint8Array(await blob.arrayBuffer()));
    const p = await prepareClip(blob, NAME, cutRange({ ...NONE, clipInS: inS, clipOutS: outS }, "mp4"), cutClip);
    assert.equal(p.kind, "failed");
    assert.equal(p.blob, blob);
    assert.equal(p.name, NAME);
    assert.equal(sha(new Uint8Array(await p.blob.arrayBuffer())), before);
    assert.equal(saveDoneLine(p), `Klippet lykkedes ikke. Sendt til Downloads som ${NAME} (hele videoen).`);
    assert.equal(shareCutLine(p), "Klippet lykkedes ikke. Delt hele videoen.");
  }
});

test("a cut and a keyframe measurement make no network request", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.reject(new Error("network during a cut"));
  }) as typeof fetch;
  try {
    await cutClip(new Blob([FIXTURE]), 1.3, 2.6);
    await keyframeTimes(new Blob([FIXTURE]));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls, 0);
});

test("cutRange edges: half or reversed user points fall through to auto; auto needs clipped", () => {
  assert.deepEqual(cutRange({ ...NONE, clipInS: 3, clipOutS: null, autoInS: 1, autoOutS: 2, autoStatus: "clipped" }, "mp4"), { reason: "auto", range: { inS: 1, outS: 2 } });
  assert.deepEqual(cutRange({ ...NONE, clipInS: 5, clipOutS: 5, autoInS: 1, autoOutS: 2, autoStatus: "clipped" }, "mp4"), { reason: "auto", range: { inS: 1, outS: 2 } });
  assert.deepEqual(cutRange({ ...NONE, clipInS: 0, clipOutS: 4 }, "mp4"), { reason: "user", range: { inS: 0, outS: 4 } });
  assert.deepEqual(cutRange({ ...NONE, autoInS: 1, autoOutS: 2, autoStatus: "low_confidence" }, "mp4"), { reason: "none", range: null });
  assert.deepEqual(cutRange({ ...NONE, autoInS: 1, autoOutS: 2, autoStatus: null }, "mp4"), { reason: "none", range: null });
});

test("comma decimals: rounding to 60 s, sub-second values and lines never show a dot decimal", () => {
  assert.equal(formatSeconds(59.96), "1:00,0");
  assert.equal(formatSeconds(59.94), "59,9 s");
  assert.equal(formatSeconds(0.04), "0,0 s");
  assert.equal(formatSeconds(600.05), "10:00,1");
  assert.equal(formatRange(12.34, 48), "12,3–48,0 s");
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < 500; i++) {
    const a = rnd() * 200;
    const b = a + 0.1 + rnd() * 200;
    const user = cutLine(cutRange({ ...NONE, clipInS: a, clipOutS: b }, "mp4")) ?? "";
    const auto = cutLine(cutRange({ ...NONE, autoInS: a, autoOutS: b, autoStatus: "clipped" }, "mp4")) ?? "";
    for (const line of [user, auto]) assert.doesNotMatch(line, /\d\.\d/, line);
    assert.match(auto, / · automatisk$/);
  }
});

test("a comma-decimal or text auto_in_s from the database fails loudly, never 0 or null", () => {
  const raw = { id: "00000000-0000-4000-8000-000000000001", date: "2026-10-17", session_no: 2, row_no: 30, set_no: 1, exercise_id: 11, variant_id: null, recorded_at: "2026-10-17T07:00:00+00:00", duration_s: 12.5, starred: false, clip_in_s: null, clip_out_s: null, auto_in_s: 1.5, auto_out_s: 9, auto_status: "clipped" };
  assert.equal(parseVideoClipRow(raw).autoInS, 1.5);
  assert.throws(() => parseVideoClipRow({ ...raw, auto_in_s: "1,5" }));
  assert.throws(() => parseVideoClipRow({ ...raw, clip_out_s: "9.0" }));
  assert.throws(() => parseVideoClipRow({ ...raw, auto_status: "maybe" }));
  assert.equal(parseVideoClipRow({ ...raw, auto_in_s: null, auto_out_s: null, auto_status: null }).autoInS, null);
});

test("Kameratest's line from the fixture's measured keyframes: comma decimals, no warning at 1 s spacing", async () => {
  const kf = await keyframeTimes(new Blob([FIXTURE]));
  const k = keyframeLines(kf, "video/mp4;codecs=avc1.42E01E");
  assert.match(k.line, /^Nøglebilleder hvert \d+,\d s \(største afstand \d+,\d\d s\) · MP4 H\.264$/);
  assert.equal(k.line.includes(`største afstand ${maxGap(kf).toFixed(2).replace(".", ",")} s`), true);
  assert.equal(k.warning, null);
});

test("seeded random ranges: every cut is plain, starts on the keyframe at or before in, ends before out, or throws empty_range", async () => {
  const kf = await keyframeTimes(new Blob([FIXTURE]));
  const end = (SRC.samples.at(-1)?.cts ?? 0) / SRC.timescale;
  let seed = 20261020;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let cuts = 0;
  for (let i = 0; i < 40; i++) {
    const inS = rnd() * (end + 1);
    const outS = inS + rnd() * 3;
    let r: Awaited<ReturnType<typeof cutClip>>;
    try {
      r = await cutClip(new Blob([FIXTURE]), inS, outS);
    } catch (e) {
      assert.ok(e instanceof CutError && e.reason === "empty_range", `${inS}–${outS}: ${String(e)}`);
      assert.ok(outS - inS < 1 / 30 || inS >= end - 0.05 || outS <= inS, `unexpected empty_range for ${inS}–${outS}`);
      continue;
    }
    cuts += 1;
    const cut = read(new Uint8Array(await r.blob.arrayBuffer()));
    assert.equal(cut.samples[0].sync, true);
    assert.equal(cut.samples[0].cts, 0);
    assert.equal(cut.duration, cut.samples.reduce((a, s) => a + s.duration, 0));
    assert.ok(r.actual.startS <= inS + 1e-9 && inS - r.actual.startS <= maxGap(kf) + 1e-9, `${inS}: start ${r.actual.startS}`);
    assert.ok(r.actual.startS + (cut.samples.at(-1)?.cts ?? 0) / cut.timescale < outS, `${outS}: last sample`);
    assert.ok(Math.abs(r.actual.endS - r.actual.startS - cut.duration / cut.timescale) < 1e-9);
  }
  assert.ok(cuts >= 20, `only ${cuts} cuts made`);
});
