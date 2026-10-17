import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { cleanupPlan } from "../src/lib/video/cleanup.ts";
import type { VideoClipRow } from "../src/lib/video/clips.ts";
import { CAMERA_CONSTRAINTS } from "../src/lib/video/constraints.ts";
import { type ClipIndexEntry, interrupted, memoryClipIndex } from "../src/lib/video/index-store.ts";
import { pickRecorderType } from "../src/lib/video/mime.ts";
import { clipPath, memoryClipFiles } from "../src/lib/video/opfs.ts";
import { shareClip, shareData, shareFileName } from "../src/lib/video/share.ts";
import { formatBytes, spaceLine } from "../src/lib/video/space.ts";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-10-17T08:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

test("mime: mp4/avc1 first, then webm vp9, vp8, else none; the extension follows", () => {
  const only = (...ok: string[]) => (t: string) => ok.includes(t);
  assert.equal(pickRecorderType(only("video/mp4;codecs=avc1", "video/webm;codecs=vp9"))?.ext, "mp4");
  assert.deepEqual(pickRecorderType(only("video/webm;codecs=vp9", "video/webm;codecs=vp8")), { mimeType: "video/webm;codecs=vp9", ext: "webm", fileType: "video/webm" });
  assert.equal(pickRecorderType(only("video/webm;codecs=vp8"))?.mimeType, "video/webm;codecs=vp8");
  assert.equal(pickRecorderType(only("video/webm")), null);
  assert.equal(pickRecorderType(undefined), null);
});

test("constraints: back camera, 1280x720 at 30 fps, no audio", () => {
  assert.deepEqual(CAMERA_CONSTRAINTS, { video: { facingMode: "environment", width: 1280, height: 720, frameRate: 30 }, audio: false });
});

function entry(n: number, recordedAt: string, extra: Partial<ClipIndexEntry> = {}): ClipIndexEntry {
  return {
    id: ID(n),
    setKey: { date: recordedAt.slice(0, 10), sessionNo: 1, row: 20, set: 1 },
    ext: "mp4",
    recordedAt,
    durationS: 12.3,
    starred: false,
    starSynced: true,
    state: "done",
    ...extra,
  };
}

function row(n: number, recordedAt: string, starred = false): VideoClipRow {
  return { id: ID(n), date: recordedAt.slice(0, 10), session: 1, row: 20, set: 1, exerciseId: 1, variantId: null, recordedAt, durationS: 12.3, starred, clipInS: null, clipOutS: null };
}

test("cleanup: older than 56 days goes unless starred on the phone or the server; missing files are reported", () => {
  const local = [
    entry(1, daysAgo(57)), // expired
    entry(2, daysAgo(55)), // kept
    entry(3, daysAgo(80), { starred: true }), // starred on the phone
    entry(4, daysAgo(80)), // starred on the server
    entry(5, daysAgo(56)), // exactly 56 days: kept
    entry(6, daysAgo(90), { state: "recording" }), // never touched while recording
    entry(7, daysAgo(10)), // the phone says recent, the server's recorded_at says expired
  ];
  const server = [row(1, daysAgo(57)), row(4, daysAgo(80), true), row(7, daysAgo(60)), row(8, daysAgo(3)), row(9, daysAgo(70), true), row(10, daysAgo(60))];
  const plan = cleanupPlan(local, server, NOW);
  assert.deepEqual(plan.deleteLocal.map((e) => e.id), [ID(1), ID(7)]);
  assert.deepEqual(plan.deleteServerOnly, [ID(10)]);
  assert.deepEqual(plan.missingFile.map((r) => r.id), [ID(8), ID(9)], "fil mangler: a recent or starred row without a file");
});

test("cleanup never deletes a starred clip", () => {
  const plan = cleanupPlan([entry(1, daysAgo(400), { starred: true }), entry(2, daysAgo(400))], [row(2, daysAgo(400), true), row(3, daysAgo(400), true)], NOW);
  assert.deepEqual(plan.deleteLocal, []);
  assert.deepEqual(plan.deleteServerOnly, []);
});

test("index: put, get, remove; recording entries left over become afbrudt", async () => {
  const index = memoryClipIndex();
  await index.put(entry(1, daysAgo(0), { state: "recording", durationS: null }));
  await index.put(entry(2, daysAgo(0), { state: "recording", durationS: null }));
  assert.equal((await index.get(ID(1)))?.state, "recording");
  assert.deepEqual(interrupted(await index.all(), ID(2)).map((e) => [e.id, e.state]), [[ID(1), "afbrudt"]]);
  await index.remove(ID(1));
  await index.remove(ID(1));
  assert.equal(await index.get(ID(1)), null);
});

test("files: clips/<uuid>.<ext>, appended chunk by chunk, read back, deleted", async () => {
  assert.equal(clipPath(ID(1), "webm"), `clips/${ID(1)}.webm`);
  const files = memoryClipFiles();
  const w = await files.create(ID(1), "mp4");
  await w.append(new Blob([new Uint8Array([1, 2])]));
  await w.append(new Blob([new Uint8Array([3])]));
  assert.equal(await files.read(ID(1), "mp4"), null, "nothing before close");
  await w.close();
  assert.deepEqual([...new Uint8Array(await (await files.read(ID(1), "mp4"))!.arrayBuffer())], [1, 2, 3]);
  assert.deepEqual(await files.names(), [`${ID(1)}.mp4`]);
  await files.remove(ID(1), "mp4");
  await files.remove(ID(1), "mp4");
  assert.equal(await files.read(ID(1), "mp4"), null);
});

test("share: the file name has the exercise, date and set, never a time of day", () => {
  assert.equal(shareFileName({ exerciseName: "Squat", date: "2026-10-17", set: 1, ext: "mp4" }), "squat-2026-10-17-saet-1.mp4");
  assert.equal(shareFileName({ exerciseName: " Tempo Squat (3-1-0) ", date: "2026-10-17", set: 3, ext: "webm" }), "tempo-squat-3-1-0-2026-10-17-saet-3.webm");
  assert.equal(shareFileName({ exerciseName: "Bænkpres på skrå", date: "2026-10-17", set: 2, ext: "mp4" }), "baenkpres-paa-skraa-2026-10-17-saet-2.mp4");
  assert.doesNotMatch(shareFileName({ exerciseName: "Squat", date: "2026-10-17", set: 1, ext: "mp4" }), /\d{2}[:.]\d{2}/);
});

test("share: canShare is checked first; a closed sheet is cancelled", async () => {
  const data = shareData(new Blob([new Uint8Array([1])]), "squat-2026-10-17-saet-1.mp4", "mp4");
  const file = data.files?.[0];
  assert.equal(file?.name, "squat-2026-10-17-saet-1.mp4");
  assert.equal(file?.type, "video/mp4");
  let shared = 0;
  const share = async () => {
    shared += 1;
  };
  assert.equal(await shareClip({ canShare: () => false, share }, data), "unsupported");
  assert.equal(shared, 0, "never shared when canShare says no");
  assert.equal(await shareClip({ share }, data), "unsupported");
  assert.equal(await shareClip({ canShare: () => true, share }, data), "shared");
  const abort = async () => {
    throw new DOMException("closed", "AbortError");
  };
  assert.equal(await shareClip({ canShare: () => true, share: abort }, data), "cancelled");
  assert.equal(await shareClip({ canShare: () => true, share: async () => Promise.reject(new Error("x")) }, data), "failed");
});

test("space: MB under 1 GB, GB with a Danish comma, missing is null", () => {
  assert.equal(formatBytes(0), "0 MB");
  assert.equal(formatBytes(400_000), "< 1 MB");
  assert.equal(formatBytes(312_400_000), "312 MB");
  assert.equal(formatBytes(999_400_000), "999 MB");
  assert.equal(formatBytes(999_600_000), "1,0 GB");
  assert.equal(formatBytes(1_234_000_000), "1,2 GB");
  assert.equal(formatBytes(12_000_000_000), "12,0 GB");
  assert.equal(formatBytes(undefined), null);
  assert.equal(formatBytes(Number.NaN), null);
  assert.deepEqual(spaceLine({ usage: 312_400_000, quota: 4_412_400_000 }), { used: "312 MB", free: "4,1 GB" });
  assert.deepEqual(spaceLine({ usage: 5 }), { used: "< 1 MB", free: null });
  assert.deepEqual(spaceLine(null), { used: null, free: null });
});

test("video_clips occurs nowhere in python/src (Python never reads it)", () => {
  const root = fileURLToPath(new URL("../../python/src", import.meta.url));
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (readFileSync(path, "utf8").includes("video_clips")) hits.push(path);
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});
