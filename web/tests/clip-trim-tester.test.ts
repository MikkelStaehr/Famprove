// Tester's proof of slice clip-trim (design/specs/clip-trim.md §7 + tech-lead T1–T7) on the real
// cut of the fake-camera fixture (cutClip, no injected cut): the cut file's measured length equals
// the index and the server within 0.1 s, Fortryd restores the original byte for byte (sha256), a
// reload past the deadline finishes, and a seeded random sequence of every action, with failing
// storage, a failing server and a backwards clock, holds the invariant after every step.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createFile, MP4BoxBuffer } from "mp4box";

import { fileFacts, keyframeTimes } from "../src/lib/video/cut.ts";
import { clipFile, type ClipIndexEntry, memoryClipIndex } from "../src/lib/video/index-store.ts";
import { type ClipFiles, memoryClipFiles } from "../src/lib/video/opfs.ts";
import { finishDueTrims, finishTrim, startTrim, TRIM_UNDO_MS, type TrimDeps, trimInvariant, undoTrim, validateTrim } from "../src/lib/video/trim.ts";

const FIXTURE = new Uint8Array(readFileSync(new URL("./fixtures/video/fake-kf.mp4", import.meta.url)));
const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
const T0 = new Date("2026-10-20T16:00:00.000Z");
const at = (ms: number): Date => new Date(T0.getTime() + ms);
const sha = (u8: Uint8Array): string => createHash("sha256").update(u8).digest("hex");
const r1 = (x: number): number => Math.round(x * 10) / 10;

/** An independent parse (mp4box directly, not cut.ts): codec string and every video sample's bytes. */
function samples(u8: Uint8Array): { codec: string; bytes: string[] } {
  const f = createFile();
  let codec = "";
  const got: string[] = [];
  f.onReady = (info) => {
    codec = info.videoTracks[0].codec;
    f.setExtractionOptions(info.videoTracks[0].id, null, { nbSamples: 1e6 });
    f.start();
  };
  f.onSamples = (_id, _u, ss) => {
    for (const s of ss) got.push(sha(new Uint8Array(s.data ?? new Uint8Array())));
  };
  f.appendBuffer(MP4BoxBuffer.fromArrayBuffer(u8.slice().buffer, 0));
  f.flush();
  return { codec, bytes: got };
}

async function u8(files: ClipFiles, name: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const b = await files.readFile(name);
  return b === null ? null : new Uint8Array(await b.arrayBuffer());
}

type Server = { durationS: number; calls: number[]; fail: boolean };

async function realWorld(): Promise<{ index: ReturnType<typeof memoryClipIndex>; files: ClipFiles; server: Server; lengthS: number }> {
  const facts = await fileFacts(new Blob([FIXTURE]));
  const lengthS = r1(facts.durationS);
  const e: ClipIndexEntry = {
    id: ID,
    setKey: { date: "2026-10-20", sessionNo: 1, row: 30, set: 1 },
    ext: "mp4",
    recordedAt: "2026-10-20T15:55:00.000Z",
    durationS: lengthS,
    starred: false,
    starSynced: true,
    state: "done",
  };
  const files = memoryClipFiles();
  await files.writeFile(`${ID}.mp4`, new Blob([FIXTURE]));
  return { index: memoryClipIndex([e]), files, server: { durationS: lengthS, calls: [], fail: false }, lengthS };
}

function serverTrim(s: Server): TrimDeps["trim"] {
  return async (input) => {
    if (s.fail) throw new Error("network");
    s.calls.push(input.durationS);
    const d = validateTrim(input.durationS, s.durationS);
    if (d === null) return { ok: false, reason: "duration" };
    s.durationS = d;
    return { ok: true, dev: false, durationS: d };
  };
}

test("T2/§7.4 real file: Gem klip's cut is the clip, its measured length = durationS within 0.1 s, starts at a keyframe ≤ in, same codec and sample bytes", async () => {
  const w = await realWorld();
  const kf = await keyframeTimes(new Blob([FIXTURE]));
  const facts = await fileFacts(new Blob([FIXTURE]));
  assert.ok(kf.length >= 2, `fixture has ${kf.length} keyframes`);
  const inS = r1(facts.durationS * 0.3);
  const outS = r1(facts.durationS * 0.8);
  const r = await startTrim({ index: w.index, files: w.files, trim: serverTrim(w.server) }, ID, inS, outS, T0);
  assert.equal(r.kind, "done");
  if (r.kind !== "done") return;
  assert.deepEqual(w.server.calls, [], "Gem klip itself sends nothing");
  const named = clipFile(r.entry);
  assert.notEqual(named, `${ID}.mp4`);
  const cutBytes = await u8(w.files, named);
  assert.ok(cutBytes !== null);
  const cutFacts = await fileFacts(new Blob([cutBytes]));
  assert.ok(Math.abs(cutFacts.durationS - (r.entry.durationS ?? Number.NaN)) <= 0.1, `file ${cutFacts.durationS} vs entry ${r.entry.durationS}`);
  assert.equal(r.toS, r.entry.durationS);
  // starts at the keyframe at or before in, within the largest keyframe gap; ends at out ± 0.1 s
  const start = Math.max(...kf.filter((k) => k <= inS));
  assert.ok(inS - start <= (facts.maxKeyframeGapS ?? 0) + 1e-9);
  assert.ok(Math.abs(start + cutFacts.durationS - outS) <= 0.1, `ends at ${start + cutFacts.durationS} vs out ${outS}`);
  // not re-encoded: same codec, and every sample of the cut is a byte-identical original sample, in order
  const src = samples(FIXTURE);
  const got = samples(cutBytes);
  assert.equal(got.codec, src.codec);
  const first = src.bytes.indexOf(got.bytes[0]);
  assert.ok(first >= 0);
  assert.deepEqual(got.bytes, src.bytes.slice(first, first + got.bytes.length));
  assert.deepEqual(trimInvariant(await w.index.all(), await w.files.names()), []);
});

test("T3/§7.6 real file: Fortryd at 9.9 s gives back the original's exact sha256 and length, deletes the cut, sends nothing; at 10 s it is expired", async () => {
  const w = await realWorld();
  const deps: TrimDeps = { index: w.index, files: w.files, trim: serverTrim(w.server) };
  const r = await startTrim(deps, ID, 1.0, 3.0, T0);
  assert.equal(r.kind, "done");
  if (r.kind !== "done") return;
  const cutName = clipFile(r.entry);
  const u = await undoTrim(deps, ID, at(TRIM_UNDO_MS - 100));
  assert.equal(u.kind, "undone");
  const back = await w.index.get(ID);
  assert.ok(back !== null);
  assert.equal(back.pendingTrim, undefined);
  assert.equal(back.durationS, w.lengthS);
  const bytes = await u8(w.files, clipFile(back));
  assert.ok(bytes !== null);
  assert.equal(sha(bytes), sha(FIXTURE));
  assert.equal(r1((await fileFacts(new Blob([bytes]))).durationS), w.lengthS);
  assert.equal(await w.files.readFile(cutName), null, "the cut file is deleted");
  assert.deepEqual(w.server.calls, []);
  assert.deepEqual(await w.files.names(), [`${ID}.mp4`]);
  // a second cut, then Fortryd exactly at the deadline: too late, the cut stays
  const r2 = await startTrim(deps, ID, 1.0, 3.0, T0);
  assert.equal(r2.kind, "done");
  assert.equal((await undoTrim(deps, ID, at(TRIM_UNDO_MS))).kind, "expired");
});

test("T4/§7.7 real file: the app closed inside the window, the next load past the deadline finishes: one PATCH = the file's length, the original gone, listed once", async () => {
  const w = await realWorld();
  const r = await startTrim({ index: w.index, files: w.files, trim: serverTrim(w.server) }, ID, 2.0, 5.0, T0);
  assert.equal(r.kind, "done");
  // "reload": fresh deps over the same storage (the in-memory timer is gone)
  const reload = (): TrimDeps => ({ index: w.index, files: w.files, trim: serverTrim(w.server) });
  const early = await finishDueTrims(reload(), at(5_000));
  assert.deepEqual(early, { finished: [], failed: [], pending: [ID] });
  assert.deepEqual(w.server.calls, []);
  const late = await finishDueTrims(reload(), at(TRIM_UNDO_MS + 60_000));
  assert.deepEqual(late, { finished: [ID], failed: [], pending: [] });
  const e = await w.index.get(ID);
  assert.ok(e !== null);
  assert.equal(e.pendingTrim, undefined);
  assert.deepEqual(await w.files.names(), [clipFile(e)], "one file: the cut");
  assert.equal((await w.index.all()).length, 1, "no clip listed twice");
  const facts = await fileFacts((await w.files.readFile(clipFile(e))) as Blob);
  assert.equal(w.server.calls.length, 1);
  assert.ok(Math.abs(w.server.durationS - facts.durationS) <= 0.1, `server ${w.server.durationS} vs file ${facts.durationS}`);
  // a further load does nothing
  await finishDueTrims(reload(), at(TRIM_UNDO_MS + 120_000));
  assert.equal(w.server.calls.length, 1);
});

/** mulberry32: a seeded PRNG so a failing sequence can be replayed by its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("T7 invariant: seeded random start/undo/finish/load with failing storage, a failing server and a backwards clock; after every step one existing file per clip, the original deleted only after the PATCH, the server's duration = the file's length", async () => {
  let commits = 0;
  let undos = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const rand = rng(seed);
    const w = await realWorld();
    const base = memoryClipFiles();
    // copy the original into the failing wrapper's backing store
    await base.writeFile(`${ID}.mp4`, new Blob([FIXTURE]));
    const env = { failWrite: false, failRemove: false };
    const files: ClipFiles = {
      ...base,
      writeFile: async (n, b) => {
        if (env.failWrite) throw new DOMException("full", "QuotaExceededError");
        return base.writeFile(n, b);
      },
      removeFile: async (n) => {
        if (env.failRemove) throw new Error("remove failed");
        const e = await w.index.get(ID);
        const p = e?.pendingTrim;
        if (p !== undefined && n === p.originalFileName) {
          assert.ok(w.server.calls.includes(p.newDurationS), `seed ${seed}: original ${n} deleted before its PATCH landed`);
        }
        return base.removeFile(n);
      },
    };
    const deps: TrimDeps = { index: w.index, files, trim: serverTrim(w.server) };
    let clock = 0;
    let committedLength = w.lengthS; // the length of the last committed file
    for (let step = 0; step < 14; step++) {
      env.failWrite = rand() < 0.15;
      env.failRemove = rand() < 0.15;
      w.server.fail = rand() < 0.2;
      const jump = rand();
      clock += jump < 0.1 ? -3_000 : jump < 0.5 ? 2_000 : jump < 0.8 ? 6_000 : 15_000; // sometimes backwards
      const now = at(clock);
      const before = await w.index.get(ID);
      assert.ok(before !== null);
      const len = before.durationS ?? 0;
      const a = rand();
      if (a < 0.35 && len > 1.5) {
        const inS = r1(rand() * (len - 1.2));
        const outS = r1(Math.min(len, inS + 1.0 + rand() * (len - inS - 1.0)));
        await startTrim(deps, ID, inS, outS, now);
      } else if (a < 0.55) {
        if ((await undoTrim(deps, ID, now)).kind === "undone") undos++;
      }
      else if (a < 0.75) await finishTrim(deps, ID, now);
      else await finishDueTrims(deps, now);

      const entries = await w.index.all();
      const names = await base.names();
      assert.equal(entries.length, 1, `seed ${seed} step ${step}: one entry`);
      const e = entries[0];
      const named = clipFile(e);
      const v = trimInvariant(entries, names).filter((x) => !x.endsWith("a file no entry names")); // a stray is the next load's sweep
      assert.deepEqual(v, [], `seed ${seed} step ${step}`);
      const blob = await base.readFile(named);
      assert.ok(blob !== null, `seed ${seed} step ${step}: ${named} exists`);
      const facts = await fileFacts(blob);
      assert.ok(Math.abs(facts.durationS - (e.durationS ?? -1)) <= 0.1, `seed ${seed} step ${step}: entry ${e.durationS} vs file ${facts.durationS}`);
      if (e.pendingTrim === undefined) {
        committedLength = facts.durationS;
        // committed and nothing pending: the server holds the file's length, unless no cut was ever committed
        if (w.server.calls.length > 0) assert.ok(Math.abs(w.server.durationS - committedLength) <= 0.1, `seed ${seed} step ${step}: server ${w.server.durationS} vs file ${committedLength}`);
      } else {
        assert.ok(names.includes(e.pendingTrim.originalFileName), `seed ${seed} step ${step}: original kept while pending`);
      }
    }
    // the environment heals: a clean load past every deadline leaves exactly one file and no stray
    env.failWrite = false;
    env.failRemove = false;
    w.server.fail = false;
    await finishDueTrims(deps, at(clock + 60_000));
    const entries = await w.index.all();
    const names = await base.names();
    assert.deepEqual(trimInvariant(entries, names), [], `seed ${seed}: healed`);
    assert.deepEqual(names, [clipFile(entries[0])], `seed ${seed}: one file`);
    void committedLength;
    commits += w.server.calls.length;
  }
  assert.ok(commits >= 5 && undos >= 3, `the sequences exercised the paths: ${commits} PATCHes, ${undos} undos`);
});
