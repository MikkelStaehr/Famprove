// Tester's proof of slice clip-approve-all (design/specs/clip-approve-all.md §acceptance + A1–A7) on the
// real cut of the fake-camera fixture (no injected cut): two approvable copies are cut to their
// automatic in/out, each cut's measured length equals its index entry within 0.1 s, Fortryd gives
// back both originals' sha256, and at the deadline (also after a reload) each clip gets exactly one
// PATCH and one clip_accuracy row of kind approved. Two non-approvable copies (off by one, Klip selv)
// ride along and stay untouched.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { approvableClips, approveAll, type ApproveDeps, finishBatch, undoBatch } from "../src/lib/video/approve-all.ts";
import { APPROVE_IDLE, approveCount, approveShown } from "../src/lib/video/approve-line.ts";
import { AUTO_CLIP } from "../src/lib/video/auto-clip.ts";
import type { AutoLast } from "../src/lib/video/auto-last.ts";
import type { VideoClipRow } from "../src/lib/video/clips.ts";
import { fileFacts, keyframeTimes } from "../src/lib/video/cut.ts";
import { clipFile, type ClipIndex, type ClipIndexEntry, memoryClipIndex } from "../src/lib/video/index-store.ts";
import { type ClipFiles, memoryClipFiles } from "../src/lib/video/opfs.ts";
import {
  accuracyRecord,
  type ClipAccuracyBody,
  finishDueTrims,
  memoryLock,
  parseTrimClipInput,
  startTrim,
  TRIM_UNDO_MS,
  trimInvariant,
  undoTrim,
  validateTrim,
} from "../src/lib/video/trim.ts";

const FIXTURE = new Uint8Array(readFileSync(new URL("./fixtures/video/fake-kf.mp4", import.meta.url)));
const TODAY = "2026-10-31";
const T0 = new Date("2026-10-31T16:00:00.000Z");
const sha = (u8: Uint8Array): string => createHash("sha256").update(u8).digest("hex");
const r1 = (x: number): number => Math.round(x * 10) / 10;

const A = "bbbbbbbb-0000-4000-8000-00000000000a"; // exact count
const B = "bbbbbbbb-0000-4000-8000-00000000000b"; // exact count
const OFF = "bbbbbbbb-0000-4000-8000-00000000000c"; // one off
const SELV = "bbbbbbbb-0000-4000-8000-00000000000d"; // Klip selv (low_confidence)
const ALL = [A, B, OFF, SELV] as const;

const last = (found: number, expected: number, kind: AutoLast["kind"] = "clipped"): AutoLast =>
  ({
    kind,
    mode: "play",
    why: null,
    runMs: 1000,
    summary: { joint: "hips", validShare: 0.9, peaksUp: found, peaksDown: 0, chosen: 1, expected, repLengths: null },
    at: T0.getTime(),
    ...(kind === "low_confidence" ? { reason: "count" } : {}),
  }) as AutoLast;

type World = {
  index: ClipIndex;
  files: ClipFiles;
  rows: Map<string, VideoClipRow>;
  patches: { id: string; durationS: number }[];
  accuracy: ClipAccuracyBody[];
  lengthS: number;
  inS: number;
  outS: number;
};

async function realWorld(): Promise<World> {
  const facts = await fileFacts(new Blob([FIXTURE]));
  const lengthS = r1(facts.durationS);
  const inS = r1(lengthS * 0.3);
  const outS = r1(lengthS * 0.8);
  const files = memoryClipFiles();
  const entries: ClipIndexEntry[] = [];
  const rows = new Map<string, VideoClipRow>();
  for (const [i, id] of ALL.entries()) {
    await files.writeFile(`${id}.mp4`, new Blob([FIXTURE.slice()]));
    const recordedAt = `2026-10-31T15:0${i}:00.000Z`;
    entries.push({ id, setKey: { date: TODAY, sessionNo: 1, row: 30, set: i + 1 }, ext: "mp4", recordedAt, durationS: lengthS, starred: false, starSynced: true, state: "done" });
    const selv = id === SELV;
    rows.set(id, {
      id,
      date: TODAY,
      session: 1,
      row: 30,
      set: i + 1,
      exerciseId: 7,
      variantId: null,
      recordedAt,
      durationS: lengthS,
      starred: false,
      clipInS: null,
      clipOutS: null,
      autoInS: selv ? null : inS,
      autoOutS: selv ? null : outS,
      autoStatus: selv ? "low_confidence" : "clipped",
    });
  }
  return { index: memoryClipIndex(entries), files, rows, patches: [], accuracy: [], lengthS, inS, outS };
}

const lasts: Record<string, AutoLast> = { [A]: last(5, 5), [B]: last(5, 5), [OFF]: last(4, 5), [SELV]: last(3, 5, "low_confidence") };

/** trimClip's server rule: the accuracy row, then the PATCH. No real database. */
function server(w: World): ApproveDeps["trim"] {
  return async (raw) => {
    const input = parseTrimClipInput(raw);
    const r = input === null ? undefined : w.rows.get(input.id);
    if (input === null || r === undefined) return { ok: false, reason: "not_found" };
    const d = validateTrim(input.durationS, r.durationS);
    if (d === null) return { ok: false, reason: "duration" };
    if (typeof input.points === "object") {
      const rec = accuracyRecord(r, input.points, d);
      if (typeof rec === "object" && rec !== null) w.accuracy.push(rec);
    }
    w.patches.push({ id: r.id, durationS: d });
    w.rows.set(r.id, { ...r, durationS: d, autoInS: null, autoOutS: null, autoStatus: null });
    return { ok: true, dev: false, durationS: d };
  };
}

async function u8(files: ClipFiles, name: string): Promise<Uint8Array> {
  const b = await files.readFile(name);
  assert.ok(b !== null, `${name} exists`);
  return new Uint8Array(await b.arrayBuffer());
}

function clock(): () => Date {
  let ms = 0;
  return () => new Date(T0.getTime() + (ms += 700));
}

async function approve(w: World) {
  const deps: ApproveDeps = { index: w.index, files: w.files, trim: server(w), lock: memoryLock(), newBatch: () => "tester-batch" };
  const clips = approvableClips([...w.rows.values()], await w.index.all(), lasts, TODAY);
  const r = await approveAll(deps, clips, clock());
  return { deps, clips, r };
}

test("A1/A2: of four real copies only the two with the exact rep count are approvable; off-by-one and Klip selv are not", async () => {
  const w = await realWorld();
  const clips = approvableClips([...w.rows.values()], await w.index.all(), lasts, TODAY);
  assert.deepEqual(clips.map((c) => c.id).toSorted(), [A, B]);
  for (const c of clips) assert.deepEqual([c.inS, c.outS], [w.inS, w.outS], "the automatic in/out, unchanged");
});

test("A3/§4 real file: each approved clip is cut by the real cut to its automatic in/out; measured length = entry within 0.1 s; others untouched", async () => {
  assert.equal(AUTO_CLIP.PAD_S, 1.0, "the automatic in/out carry the 1.0 s margin");
  const w = await realWorld();
  const kf = await keyframeTimes(new Blob([FIXTURE]));
  const facts = await fileFacts(new Blob([FIXTURE]));
  const { r } = await approve(w);
  assert.deepEqual(r.done.toSorted(), [A, B]);
  assert.deepEqual(r.failed, []);
  assert.equal(w.patches.length, 0, "no server write inside the window");
  const start = Math.max(...kf.filter((k) => k <= w.inS));
  for (const id of [A, B]) {
    const e = await w.index.get(id);
    assert.ok(e !== null);
    assert.equal(e.pendingTrim?.kind, "approved");
    assert.equal(e.pendingTrim?.batch, "tester-batch");
    assert.deepEqual([e.pendingTrim?.inS, e.pendingTrim?.outS], [w.inS, w.outS]);
    const name = clipFile(e);
    assert.notEqual(name, `${id}.mp4`);
    const cut = await fileFacts(new Blob([(await u8(w.files, name)).slice()]));
    assert.ok(Math.abs(cut.durationS - (e.durationS ?? Number.NaN)) <= 0.1, `${id}: file ${cut.durationS} vs entry ${e.durationS}`);
    assert.ok(w.inS - start <= (facts.maxKeyframeGapS ?? 0) + 1e-9, "starts at the keyframe at or before in");
    assert.ok(Math.abs(start + cut.durationS - w.outS) <= 0.1, `${id}: ends at ${start + cut.durationS} vs out ${w.outS}`);
  }
  for (const id of [OFF, SELV]) {
    const e = await w.index.get(id);
    assert.equal(clipFile(e!), `${id}.mp4`);
    assert.equal(e?.pendingTrim, undefined);
    assert.equal(sha(await u8(w.files, `${id}.mp4`)), sha(FIXTURE), `${id} untouched`);
  }
  assert.deepEqual(trimInvariant(await w.index.all(), await w.files.names()), []);
});

test("A5/§6 real file: Fortryd 1 ms before the deadline gives back both originals' sha256 and length, deletes the cuts, writes nothing", async () => {
  const w = await realWorld();
  const { deps, r } = await approve(w);
  assert.ok(r.deadline !== null);
  const u = await undoBatch(deps, r.batch, new Date(Date.parse(r.deadline) - 1));
  assert.equal(u.kind, "undone");
  if (u.kind === "undone") assert.deepEqual(u.restored.toSorted(), [A, B]);
  for (const id of [A, B]) {
    const e = await w.index.get(id);
    assert.equal(clipFile(e!), `${id}.mp4`);
    assert.equal(e?.durationS, w.lengthS);
    assert.equal(e?.pendingTrim, undefined);
    assert.equal(sha(await u8(w.files, `${id}.mp4`)), sha(FIXTURE), `${id} byte for byte`);
  }
  assert.deepEqual((await w.files.names()).toSorted(), ALL.map((id) => `${id}.mp4`).toSorted(), "no cut file left");
  assert.deepEqual([w.patches.length, w.accuracy.length], [0, 0]);
});

test("A6/§6: at the deadline each clip gets exactly one PATCH and one approved clip_accuracy row; a second finish writes nothing", async () => {
  const w = await realWorld();
  const { deps, r } = await approve(w);
  const at = new Date(r.deadline!);
  assert.ok(at.getTime() - T0.getTime() >= TRIM_UNDO_MS);
  const fin = await finishBatch(deps, r.done, at);
  assert.deepEqual(Object.values(fin), ["done", "done"]);
  assert.deepEqual(w.patches.map((p) => p.id).toSorted(), [A, B]);
  assert.deepEqual(w.accuracy.map((a) => a.kind), ["approved", "approved"]);
  for (const a of w.accuracy) assert.deepEqual([a.auto_in_s, a.auto_out_s, a.user_in_s, a.user_out_s], [w.inS, w.outS, null, null]);
  await finishBatch(deps, r.done, at);
  await finishDueTrims(deps, new Date(at.getTime() + 60_000));
  assert.equal(w.patches.length, 2, "exactly one write per cut clip");
  assert.equal(w.accuracy.length, 2);
  for (const id of [A, B]) assert.equal((await w.index.get(id))?.pendingTrim, undefined);
});

test("A6 after a reload: the page dies inside the window; the next load past the deadline finishes each clip once with an approved row", async () => {
  const w = await realWorld();
  const { r } = await approve(w);
  // reload: new deps, same storage; the old page's timer never fired
  const reloaded: ApproveDeps = { index: w.index, files: w.files, trim: server(w), lock: memoryLock() };
  const early = await finishDueTrims(reloaded, new Date(Date.parse(r.deadline!) - 1));
  assert.deepEqual(early.finished, [], "inside the window nothing is finished");
  assert.equal(w.patches.length, 0);
  const late = await finishDueTrims(reloaded, new Date(Date.parse(r.deadline!) + 1));
  assert.deepEqual(late.finished.toSorted(), [A, B]);
  assert.deepEqual(w.accuracy.map((a) => a.kind), ["approved", "approved"]);
  assert.equal(w.patches.length, 2);
  await finishDueTrims(reloaded, new Date(Date.parse(r.deadline!) + 60_000));
  assert.equal(w.patches.length, 2, "a second load writes nothing");
});

test("A4 real file: one clip whose file is unreadable fails alone; the other is cut and the failed one stays whole", async () => {
  const w = await realWorld();
  await w.files.writeFile(`${B}.mp4`, new Blob([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])])); // a broken original
  const { r } = await approve(w);
  assert.deepEqual(r.done, [A]);
  assert.deepEqual(r.failed, [{ id: B, space: false }]);
  const eb = await w.index.get(B);
  assert.equal(clipFile(eb!), `${B}.mp4`);
  assert.equal(eb?.pendingTrim, undefined);
  assert.deepEqual([...(await u8(w.files, `${B}.mp4`))], [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal((await w.index.get(A))?.pendingTrim?.batch, "tester-batch");
  assert.deepEqual(trimInvariant(await w.index.all(), await w.files.names()), []);
});

test("A7: with Auto-klip off the button is hidden whatever N is", () => {
  for (const n of [0, 1, 2, 9]) {
    assert.equal(approveShown(false, n, APPROVE_IDLE), false);
    assert.equal(approveCount(false, n, APPROVE_IDLE), 0);
  }
  assert.equal(approveCount(true, 2, APPROVE_IDLE), 2);
});

test("comma decimal: a duration sent as text ('35,9') is refused, never read as 35 or 0", () => {
  assert.equal(validateTrim("35,9", 50), null);
  assert.equal(validateTrim("35.9", 50), null);
  assert.equal(validateTrim(35.9, 50), 35.9);
});

/** The user's own Gem klip in the player: a range unlike the automatic one. */
async function snapshot(w: World, id: string) {
  const e = await w.index.get(id);
  assert.ok(e !== null);
  return { pendingTrim: e.pendingTrim, file: clipFile(e), sha: sha(await u8(w.files, clipFile(e))), durationS: e.durationS };
}

for (const mode of ["sequential", "concurrent"] as const) {
  test(`race (${mode}, real file): a Gem klip on B lands first; the batch skips B, leaves its cut and pending Fortryd byte for byte, and still cuts A`, async () => {
    const w = await realWorld();
    const deps: ApproveDeps = { index: w.index, files: w.files, trim: server(w), lock: memoryLock(), newBatch: () => "tester-batch" };
    const clips = approvableClips([...w.rows.values()], await w.index.all(), lasts, TODAY); // the list the tap saw
    assert.deepEqual(clips.map((c) => c.id).toSorted(), [A, B]);
    const ownIn = r1(w.lengthS * 0.1);
    const ownOut = r1(w.lengthS * 0.6);
    let r: Awaited<ReturnType<typeof approveAll>>;
    if (mode === "sequential") {
      const own = await startTrim(deps, B, ownIn, ownOut, T0, "own");
      assert.equal(own.kind, "done");
      const before = await snapshot(w, B);
      r = await approveAll(deps, clips, clock());
      assert.deepEqual(await snapshot(w, B), before, "B: same bytes, same pendingTrim, same file");
    } else {
      const own = startTrim(deps, B, ownIn, ownOut, T0, "own"); // takes B's lock before the batch's first await
      const batch = approveAll(deps, clips, clock());
      assert.equal((await own).kind, "done");
      r = await batch;
    }
    assert.deepEqual(r.done, [A]);
    assert.deepEqual(r.failed, [{ id: B, space: false, notOriginal: true }]);
    const eb = await w.index.get(B);
    assert.equal(eb?.pendingTrim?.kind, "own");
    assert.equal(eb?.pendingTrim?.batch, undefined, "B's Fortryd is still the user's own, not the batch's");
    assert.deepEqual([eb?.pendingTrim?.inS, eb?.pendingTrim?.outS], [ownIn, ownOut]);
    const ea = await w.index.get(A);
    assert.equal(ea?.pendingTrim?.batch, "tester-batch");
    assert.deepEqual([ea?.pendingTrim?.inS, ea?.pendingTrim?.outS], [w.inS, w.outS]);
    assert.notEqual(sha(await u8(w.files, clipFile(ea!))), sha(FIXTURE), "A is cut");
    assert.deepEqual(trimInvariant(await w.index.all(), await w.files.names()), []);
    // the batch's Fortryd gives back A only; B keeps the user's cut
    const bSnap = await snapshot(w, B);
    const u = await undoBatch(deps, r.batch, new Date(Date.parse(r.deadline!) - 1));
    assert.equal(u.kind, "undone");
    if (u.kind === "undone") assert.deepEqual(u.restored, [A]);
    assert.equal(sha(await u8(w.files, `${A}.mp4`)), sha(FIXTURE), "A byte for byte");
    assert.deepEqual(await snapshot(w, B), bSnap, "batch Fortryd leaves B alone");
    // the user's own Fortryd still works and restores B byte for byte
    const ub = await undoTrim(deps, B, new Date(Date.parse(eb!.pendingTrim!.deadline) - 1));
    assert.equal(ub.kind, "undone");
    assert.equal(clipFile((await w.index.get(B))!), `${B}.mp4`);
    assert.equal(sha(await u8(w.files, `${B}.mp4`)), sha(FIXTURE), "B byte for byte");
    assert.deepEqual([w.patches.length, w.accuracy.length], [0, 0]);
  });
}

test("race (real file): finishing after the skip gives A an approved row and B the user's own row, one PATCH each", async () => {
  const w = await realWorld();
  const deps: ApproveDeps = { index: w.index, files: w.files, trim: server(w), lock: memoryLock(), newBatch: () => "tester-batch" };
  const clips = approvableClips([...w.rows.values()], await w.index.all(), lasts, TODAY);
  const ownIn = r1(w.lengthS * 0.1);
  const ownOut = r1(w.lengthS * 0.6);
  assert.equal((await startTrim(deps, B, ownIn, ownOut, T0, "own")).kind, "done");
  const r = await approveAll(deps, clips, clock());
  await finishDueTrims(deps, new Date(Date.parse(r.deadline!) + TRIM_UNDO_MS + 1));
  assert.deepEqual(w.patches.map((p) => p.id).toSorted(), [A, B].toSorted());
  const kinds = Object.fromEntries(w.accuracy.map((a) => [a.clip_id, a.kind]));
  assert.deepEqual(kinds, { [A]: "approved", [B]: "own" });
});
