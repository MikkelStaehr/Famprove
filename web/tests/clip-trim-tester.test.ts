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
import {
  type ClipLock,
  finishDueTrims,
  finishTrim,
  memoryLock,
  startTrim,
  TRIM_UNDO_MS,
  type TrimClipResult,
  type TrimDeps,
  trimInvariant,
  undoTrim,
  validateTrim,
} from "../src/lib/video/trim.ts";

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
  assert.deepEqual(early, { finished: [], failed: [], refused: [], pending: [ID] });
  assert.deepEqual(w.server.calls, []);
  const late = await finishDueTrims(reload(), at(TRIM_UNDO_MS + 60_000));
  assert.deepEqual(late, { finished: [ID], failed: [], refused: [], pending: [] });
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

// --- re-run on the fix 8a924fd: the per-clip lock, the permanent refusal's rollback, the clamp -----

for (const reason of ["duration", "invalid", "not_allowed"] as const) {
  test(`fix: a permanent refusal (${reason}) at 0 rolls back: the original's exact bytes and length are the clip, the cut deleted, nothing pending, listed as refused`, async () => {
    const w = await realWorld();
    const calls: number[] = [];
    const trim: TrimDeps["trim"] = async (input): Promise<TrimClipResult> => {
      calls.push(input.durationS);
      return { ok: false, reason };
    };
    const deps: TrimDeps = { index: w.index, files: w.files, trim };
    const r = await startTrim(deps, ID, 1.0, 3.0, T0);
    assert.equal(r.kind, "done");
    if (r.kind !== "done") return;
    const cutName = clipFile(r.entry);
    const out = await finishDueTrims(deps, at(TRIM_UNDO_MS));
    assert.deepEqual(out, { finished: [], failed: [], refused: [ID], pending: [] });
    assert.equal(calls.length, 1, "one PATCH, no retry loop");
    const e = await w.index.get(ID);
    assert.ok(e !== null);
    assert.equal(e.pendingTrim, undefined);
    assert.equal(e.durationS, w.lengthS);
    assert.equal(clipFile(e), `${ID}.mp4`);
    const bytes = await u8(w.files, clipFile(e));
    assert.ok(bytes !== null);
    assert.equal(sha(bytes), sha(FIXTURE));
    assert.equal(await w.files.readFile(cutName), null);
    assert.deepEqual(await w.files.names(), [`${ID}.mp4`]);
    assert.deepEqual(trimInvariant(await w.index.all(), await w.files.names()), []);
    // a later load does nothing more
    await finishDueTrims(deps, at(TRIM_UNDO_MS + 60_000));
    assert.equal(calls.length, 1);
  });
}

test("fix: a network failure (thrown, or reason failed) at 0 is not permanent: the cut stays pending with the original kept, and the next load commits", async () => {
  const w = await realWorld();
  let mode: "throw" | "failed" | "ok" = "throw";
  const ok = serverTrim(w.server);
  const trim: TrimDeps["trim"] = async (input) => {
    if (mode === "throw") throw new Error("network");
    if (mode === "failed") return { ok: false, reason: "failed" };
    return ok(input);
  };
  const deps: TrimDeps = { index: w.index, files: w.files, trim };
  const r = await startTrim(deps, ID, 1.0, 3.0, T0);
  assert.equal(r.kind, "done");
  assert.equal(await finishTrim(deps, ID, at(TRIM_UNDO_MS)), "failed");
  mode = "failed";
  assert.equal(await finishTrim(deps, ID, at(TRIM_UNDO_MS + 1)), "failed");
  const e = await w.index.get(ID);
  assert.ok(e?.pendingTrim !== undefined);
  assert.ok((await w.files.names()).includes(e.pendingTrim.originalFileName));
  mode = "ok";
  assert.equal(await finishTrim(deps, ID, at(TRIM_UNDO_MS + 2)), "done");
  const done = await w.index.get(ID);
  assert.ok(done !== null);
  assert.deepEqual(await w.files.names(), [clipFile(done)]);
});

test("fix: the clamp keeps the new duration ≤ the clip's own length, for a cut that measures over it and for the real cut of the whole file", async () => {
  // a cut that reports 0.3 s more than the clip (first keyframe to the end measuring over)
  const w = await realWorld();
  const over: TrimDeps["cut"] = async (file) => ({ blob: file, actual: { startS: 0, endS: w.lengthS + 0.3 } });
  const r = await startTrim({ index: w.index, files: w.files, trim: serverTrim(w.server), cut: over }, ID, 0, w.lengthS, T0);
  assert.equal(r.kind, "done");
  if (r.kind !== "done") return;
  assert.ok(r.toS <= w.lengthS, `toS ${r.toS} > clip ${w.lengthS}`);
  assert.ok((r.entry.durationS ?? Number.POSITIVE_INFINITY) <= w.lengthS);
  assert.ok((r.entry.pendingTrim?.newDurationS ?? Number.POSITIVE_INFINITY) <= w.lengthS);
  // the finish's PATCH is then accepted (never a raise), not refused
  assert.equal(await finishTrim({ index: w.index, files: w.files, trim: serverTrim(w.server) }, ID, at(TRIM_UNDO_MS)), "done");
  assert.ok(w.server.durationS <= w.lengthS);
  // the real cut (cutClip) of the whole fixture
  const v = await realWorld();
  const r2 = await startTrim({ index: v.index, files: v.files, trim: serverTrim(v.server) }, ID, 0, v.lengthS, T0);
  assert.equal(r2.kind, "done");
  if (r2.kind !== "done") return;
  assert.ok(r2.toS <= v.lengthS && (r2.entry.pendingTrim?.newDurationS ?? Number.POSITIVE_INFINITY) <= v.lengthS);
});

test("fix T3 race: Fortryd and the finish fired together without awaiting at 9.9 s / 10 s: exactly one wins, never zero files, the original never deleted before its PATCH", async () => {
  for (const [undoAt, firstUndo] of [
    [TRIM_UNDO_MS - 100, true],
    [TRIM_UNDO_MS - 100, false],
    [TRIM_UNDO_MS, true],
  ] as const) {
    const w = await realWorld();
    const deps: TrimDeps = { index: w.index, files: w.files, trim: serverTrim(w.server), lock: memoryLock() };
    assert.equal((await startTrim(deps, ID, 1.0, 3.0, T0)).kind, "done");
    const u = undoTrim(deps, ID, at(undoAt));
    const f = finishTrim(deps, ID, at(TRIM_UNDO_MS), { force: !firstUndo });
    const [ur, fr] = await Promise.all([u, f]); // both fired before either is awaited
    const e = await w.index.get(ID);
    assert.ok(e !== null);
    const names = await w.files.names();
    assert.deepEqual(names, [clipFile(e)], `one file (${undoAt}, undo first ${firstUndo})`);
    assert.equal(e.pendingTrim, undefined);
    if (ur.kind === "undone") {
      assert.equal(sha((await u8(w.files, clipFile(e))) ?? new Uint8Array()), sha(FIXTURE));
      assert.deepEqual(w.server.calls, []);
      assert.equal(fr, "done");
    } else {
      assert.equal(ur.kind, "expired");
      assert.equal(w.server.calls.length, 1);
    }
  }
});

test("fix T7 invariant on the real fixture: seeded steps that fire start/undo/finish/load on the same clip together without awaiting (memory lock and navigator.locks), with failing storage, a failing or refusing server and a backwards clock: never zero files, the named file never deleted, the original never deleted before its PATCH", async () => {
  let races = 0;
  let undone = 0;
  let refused = 0;
  let committed = 0;
  for (let seed = 101; seed <= 116; seed++) {
    const rand = rng(seed);
    const w = await realWorld();
    const base = memoryClipFiles();
    await base.writeFile(`${ID}.mp4`, new Blob([FIXTURE]));
    const env = { failWrite: false, failRemove: false, refuse: false };
    const files: ClipFiles = {
      ...base,
      writeFile: async (n, b) => {
        if (env.failWrite) throw new DOMException("full", "QuotaExceededError");
        return base.writeFile(n, b);
      },
      removeFile: async (n) => {
        if (env.failRemove) throw new Error("remove failed");
        const e = await w.index.get(ID);
        assert.ok(e !== null);
        assert.notEqual(n, clipFile(e), `seed ${seed}: the file the index names (${n}) was deleted`);
        const p = e.pendingTrim;
        if (p !== undefined && n === p.originalFileName) {
          assert.ok(w.server.calls.includes(p.newDurationS), `seed ${seed}: original ${n} deleted before its PATCH landed`);
        }
        await base.removeFile(n);
        assert.ok((await base.names()).length >= 1, `seed ${seed}: zero files after removing ${n}`);
      },
    };
    const ok = serverTrim(w.server);
    const trim: TrimDeps["trim"] = async (input) => (env.refuse ? { ok: false, reason: "duration" } : ok(input));
    const lock: ClipLock | undefined = seed % 4 === 0 ? undefined : memoryLock(); // undefined = navigator.locks
    const deps: TrimDeps = { index: w.index, files, trim, lock };
    let clock = 0;
    for (let step = 0; step < 16; step++) {
      env.failWrite = rand() < 0.12;
      env.failRemove = rand() < 0.12;
      env.refuse = rand() < 0.1;
      w.server.fail = rand() < 0.15;
      const jump = rand();
      clock += jump < 0.1 ? -3_000 : jump < 0.45 ? 2_000 : jump < 0.75 ? 6_000 : 12_000;
      const now = at(clock);
      const before = await w.index.get(ID);
      assert.ok(before !== null);
      const len = before.durationS ?? 0;
      const ops: Promise<unknown>[] = [];
      const n = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const a = rand();
        if (a < 0.3 && len > 1.5) {
          const inS = r1(rand() * (len - 1.2));
          const outS = r1(Math.min(len, inS + 1.0 + rand() * (len - inS - 1.0)));
          ops.push(startTrim(deps, ID, inS, outS, now));
        } else if (a < 0.55) {
          ops.push(undoTrim(deps, ID, now).then((u) => (u.kind === "undone" ? undone++ : 0)));
        } else if (a < 0.8) {
          ops.push(finishTrim(deps, ID, now, { force: rand() < 0.3 }).then((f) => (f === "refused" ? refused++ : 0)));
        } else ops.push(finishDueTrims(deps, now));
      }
      if (ops.length > 1) races++;
      await Promise.all(ops);

      const entries = await w.index.all();
      const names = await base.names();
      assert.equal(entries.length, 1, `seed ${seed} step ${step}: one entry`);
      const e = entries[0];
      const v = trimInvariant(entries, names).filter((x) => !x.endsWith("a file no entry names"));
      assert.deepEqual(v, [], `seed ${seed} step ${step}`);
      const blob = await base.readFile(clipFile(e));
      assert.ok(blob !== null, `seed ${seed} step ${step}: ${clipFile(e)} exists`);
      const facts = await fileFacts(blob);
      assert.ok(Math.abs(facts.durationS - (e.durationS ?? -1)) <= 0.1, `seed ${seed} step ${step}: entry ${e.durationS} vs file ${facts.durationS}`);
      if (e.pendingTrim === undefined && w.server.calls.length > 0 && e.durationS !== w.lengthS) {
        assert.ok(Math.abs(w.server.durationS - facts.durationS) <= 0.1, `seed ${seed} step ${step}: server ${w.server.durationS} vs file ${facts.durationS}`);
      }
      if (e.pendingTrim !== undefined) assert.ok(names.includes(e.pendingTrim.originalFileName), `seed ${seed} step ${step}: original kept while pending`);
    }
    env.failWrite = false;
    env.failRemove = false;
    env.refuse = false;
    w.server.fail = false;
    await finishDueTrims(deps, at(clock + 120_000));
    const entries = await w.index.all();
    const names = await base.names();
    assert.deepEqual(trimInvariant(entries, names), [], `seed ${seed}: healed`);
    assert.deepEqual(names, [clipFile(entries[0])], `seed ${seed}: one file`);
    committed += w.server.calls.length;
  }
  assert.ok(races >= 50 && undone >= 3 && committed >= 5, `paths exercised: ${races} races, ${undone} undos, ${refused} refusals, ${committed} PATCHes`);
});
