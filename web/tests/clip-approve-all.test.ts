import assert from "node:assert/strict";
import { test } from "node:test";

import { approvableClips, approveAll, type ApproveDeps, batchGuard, finishBatch, pendingTrimBatches, rearmableBatches, undoBatch } from "../src/lib/video/approve-all.ts";
import type { AutoLast } from "../src/lib/video/auto-last.ts";
import type { VideoClipRow } from "../src/lib/video/clips.ts";
import { clipFile, type ClipIndex, type ClipIndexEntry, memoryClipIndex } from "../src/lib/video/index-store.ts";
import { type ClipFiles, memoryClipFiles } from "../src/lib/video/opfs.ts";
import {
  accuracyRecord,
  type ClipAccuracyBody,
  type CutResult,
  finishDueTrims,
  memoryLock,
  parseTrimClipInput,
  startTrim,
  TRIM_UNDO_MS,
  trimInvariant,
  undoTrim,
  validateTrim,
} from "../src/lib/video/trim.ts";

const TODAY = "2026-10-31";
const T0 = new Date("2026-10-31T16:00:00.000Z");
const at = (ms: number): Date => new Date(T0.getTime() + ms);
const IDS = ["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002", "aaaaaaaa-0000-4000-8000-000000000003"] as const;

const row = (id: string, over: Partial<VideoClipRow> = {}): VideoClipRow => ({
  id,
  date: TODAY,
  session: 1,
  row: 30,
  set: 1,
  exerciseId: 7,
  variantId: null,
  recordedAt: "2026-10-31T15:00:00.000Z",
  durationS: 50,
  starred: false,
  clipInS: null,
  clipOutS: null,
  autoInS: 4.2,
  autoOutS: 39.6,
  autoStatus: "clipped",
  ...over,
});

const entry = (id: string, over: Partial<ClipIndexEntry> = {}): ClipIndexEntry => ({
  id,
  setKey: { date: TODAY, sessionNo: 1, row: 30, set: 1 },
  ext: "mp4",
  recordedAt: "2026-10-31T15:00:00.000Z",
  durationS: 50,
  starred: false,
  starSynced: true,
  state: "done",
  ...over,
});

const last = (found: number, expected: number | null, over: Partial<AutoLast> = {}): AutoLast => ({
  kind: "clipped",
  mode: "play",
  why: null,
  runMs: 20_000,
  summary: { joint: "hips", validShare: 0.95, peaksUp: found, peaksDown: 99, chosen: 1, expected, repLengths: null },
  at: T0.getTime(),
  ...over,
});

test("approvableClips: only today's exact-count automatic clips on an untouched original, newest first", () => {
  const cases: { name: string; row?: Partial<VideoClipRow>; entry?: Partial<ClipIndexEntry> | null; last?: AutoLast | null; ok: boolean }[] = [
    { name: "exact count", ok: true },
    { name: "one off (clipped allows it, approve does not)", last: last(4, 5), ok: false },
    { name: "one over", last: last(6, 5), ok: false },
    { name: "Klip selv: low_confidence", row: { autoStatus: "low_confidence", autoInS: null, autoOutS: null }, ok: false },
    { name: "Klip selv: failed", row: { autoStatus: "failed", autoInS: null, autoOutS: null }, ok: false },
    { name: "not analysed yet", row: { autoStatus: null, autoInS: null, autoOutS: null }, ok: false },
    { name: "already cut", entry: { fileName: "X.cut.mp4" }, ok: false },
    { name: "a cut pending", entry: { pendingTrim: { deadline: T0.toISOString(), originalFileName: "X.mp4", originalDurationS: 50, newDurationS: 30 } }, ok: false },
    { name: "own range", row: { clipInS: 3, clipOutS: 40 }, ok: false },
    { name: "another day (row)", row: { date: "2026-10-30" }, ok: false },
    { name: "another day (local)", entry: { setKey: { date: "2026-10-30", sessionNo: 1, row: 30, set: 1 } }, ok: false },
    { name: "pending delete", entry: { pendingDelete: { deadline: T0.toISOString(), batch: "b" } }, ok: false },
    { name: "being recorded", entry: { state: "recording", durationS: null }, ok: false },
    { name: "afbrudt", entry: { state: "afbrudt" }, ok: false },
    { name: "no local file", entry: null, ok: false },
    { name: "summary missing", last: { ...last(5, 5), summary: undefined }, ok: false },
    { name: "no local run", last: null, ok: false },
    { name: "local last low_confidence", last: last(5, 5, { kind: "low_confidence", reason: "count" }), ok: false },
    { name: "expected unknown", last: last(5, null), ok: false },
    { name: "polarity unknown", last: { ...last(5, 5), summary: { ...last(5, 5).summary!, chosen: null } }, ok: false },
    { name: "down polarity exact", last: { ...last(5, 5), summary: { ...last(5, 5).summary!, peaksUp: 2, peaksDown: 5, chosen: -1 } }, ok: true },
  ];
  for (const c of cases) {
    const id = IDS[0];
    const rows = [row(id, c.row)];
    const entries = c.entry === null ? [] : [entry(id, c.entry)];
    const lasts: Record<string, AutoLast> = c.last === null ? {} : { [id]: c.last ?? last(5, 5) };
    const got = approvableClips(rows, entries, lasts, TODAY);
    assert.equal(got.length, c.ok ? 1 : 0, c.name);
    if (c.ok) assert.deepEqual(got[0], { id, inS: 4.2, outS: 39.6, recordedAt: rows[0].recordedAt }, c.name);
  }
  const rows = IDS.map((id, i) => row(id, { recordedAt: `2026-10-31T1${i}:00:00.000Z` }));
  const got = approvableClips(rows, IDS.map((id) => entry(id)), Object.fromEntries(IDS.map((id) => [id, last(5, 5)])), TODAY);
  assert.deepEqual(got.map((c) => c.id), [IDS[2], IDS[1], IDS[0]], "newest first");
});

// --- the batch, with fakes -------------------------------------------------------------------------

/** The fake cut: the keyframe 0.5 s before in; the bytes a slice of the original. */
async function fakeCut(file: Blob, inS: number, outS: number): Promise<CutResult> {
  const startS = Math.round((inS - 0.5) * 10) / 10;
  const bytes = new Uint8Array(await file.arrayBuffer()).slice(10, 60);
  return { blob: new Blob([bytes]), actual: { startS, endS: outS } };
}

const originalBytes = (i: number): Uint8Array<ArrayBuffer> => new Uint8Array(Array.from({ length: 80 }, (_, k) => (k * 7 + i * 31) % 256));

type World = { index: ClipIndex; files: ClipFiles; rows: Map<string, VideoClipRow>; accuracy: ClipAccuracyBody[]; calls: number };

async function world(): Promise<World> {
  const files = memoryClipFiles();
  for (const [i, id] of IDS.entries()) await files.writeFile(`${id}.mp4`, new Blob([originalBytes(i)]));
  return { index: memoryClipIndex(IDS.map((id) => entry(id))), files, rows: new Map(IDS.map((id) => [id, row(id)])), accuracy: [], calls: 0 };
}

/** trimClip's rule: the accuracy row first (clip-accuracy-log), then the PATCH (duration, auto_* and own range null). */
function serverTrim(w: World): ApproveDeps["trim"] {
  return async (raw) => {
    w.calls += 1;
    const input = parseTrimClipInput(raw);
    const r = input === null ? undefined : w.rows.get(input.id);
    if (input === null || r === undefined) return { ok: false, reason: "not_found" };
    const d = validateTrim(input.durationS, r.durationS);
    if (d === null) return { ok: false, reason: "duration" };
    if (typeof input.points === "object") {
      const rec = accuracyRecord(r, input.points, d);
      if (typeof rec === "object" && rec !== null) w.accuracy.push(rec);
    }
    w.rows.set(r.id, { ...r, durationS: d, clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null });
    return { ok: true, dev: false, durationS: d };
  };
}

const deps = (w: World, over: Partial<ApproveDeps> = {}): ApproveDeps => ({ index: w.index, files: w.files, trim: serverTrim(w), cut: fakeCut, lock: memoryLock(), newBatch: () => "batch-1", ...over });
const clips = (w: World) => approvableClips([...w.rows.values()], IDS.map((id) => entry(id)), Object.fromEntries(IDS.map((id) => [id, last(5, 5)])), TODAY);

async function bytes(files: ClipFiles, name: string): Promise<number[] | null> {
  const b = await files.readFile(name);
  return b === null ? null : [...new Uint8Array(await b.arrayBuffer())];
}

/** A clock that moves 1 s per read, so each cut has its own time. */
function clock(): () => Date {
  let ms = 0;
  return () => at((ms += 1000));
}

test("approveAll: one batch, one shared deadline (the last cut's), progress per clip; at the deadline each finishes and records an approved row", async () => {
  const w = await world();
  const d = deps(w);
  const progress: string[] = [];
  const r = await approveAll(d, clips(w), clock(), (p) => progress.push(`${p.done}/${p.failed}/${p.total}`));
  assert.deepEqual(r.done.length, 3);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(progress, ["1/0/3", "2/0/3", "3/0/3"]);
  assert.equal(r.deadline, at(3000 + TRIM_UNDO_MS).toISOString(), "the latest deadline: the last cut's");
  const entries = await w.index.all();
  assert.ok(entries.every((e) => e.pendingTrim?.batch === "batch-1" && e.pendingTrim.deadline === r.deadline && e.pendingTrim.kind === "approved"));
  assert.deepEqual(pendingTrimBatches(entries), [{ batch: "batch-1", ids: [...r.done], deadline: r.deadline }]);
  assert.equal(w.calls, 0, "no server write inside the window");
  const fin = await finishBatch(d, r.done, new Date(r.deadline!));
  assert.ok(Object.values(fin).every((x) => x === "done"));
  assert.equal(w.accuracy.length, 3);
  for (const a of w.accuracy) assert.deepEqual([a.kind, a.auto_in_s, a.auto_out_s, a.user_in_s, a.user_out_s, a.duration_s], ["approved", 4.2, 39.6, null, null, 50]);
  for (const id of IDS) {
    assert.deepEqual(await w.files.names().then((n) => n.filter((x) => x.startsWith(id))), [`${id}.cut.mp4`]);
    assert.equal(w.rows.get(id)?.durationS, 35.9, "the cut from the keyframe 3.7 to 39.6");
  }
  assert.deepEqual(trimInvariant(await w.index.all(), await w.files.names()), []);
});

test("approveAll: one clip failing to cut leaves its original; the others still cut", async () => {
  const w = await world();
  const bad = IDS[1];
  const cut: ApproveDeps["cut"] = async (file, i, o) => {
    if (new Uint8Array(await file.arrayBuffer())[0] === originalBytes(1)[0]) throw new Error("demux"); // the second clip's original
    return fakeCut(file, i, o);
  };
  const r = await approveAll(deps(w, { cut }), clips(w), clock());
  assert.deepEqual(r.failed, [{ id: bad, space: false }]);
  assert.equal(r.done.length, 2);
  const e = await w.index.get(bad);
  assert.equal(clipFile(e!), `${bad}.mp4`);
  assert.equal(e?.pendingTrim, undefined);
  assert.deepEqual(await bytes(w.files, `${bad}.mp4`), [...originalBytes(1)]);
  for (const id of r.done) assert.equal((await w.index.get(id))?.pendingTrim?.batch, "batch-1");
});

test("undoBatch: Fortryd restores every clip byte for byte, writes nothing to the server; after the deadline it is expired", async () => {
  const w = await world();
  const d = deps(w);
  const r = await approveAll(d, clips(w), clock());
  const u = await undoBatch(d, r.batch, new Date(Date.parse(r.deadline!) - 1));
  assert.equal(u.kind, "undone");
  if (u.kind === "undone") assert.deepEqual([u.restored.length, u.expired.length, u.failed.length], [3, 0, 0]);
  for (const [i, id] of IDS.entries()) {
    const e = await w.index.get(id);
    assert.equal(clipFile(e!), `${id}.mp4`);
    assert.equal(e?.durationS, 50);
    assert.equal(e?.pendingTrim, undefined);
    assert.deepEqual(await bytes(w.files, `${id}.mp4`), [...originalBytes(i)]);
  }
  assert.deepEqual((await w.files.names()).toSorted(), IDS.map((id) => `${id}.mp4`).toSorted());
  assert.equal(w.calls, 0);
  assert.equal(w.accuracy.length, 0);
  assert.deepEqual(await undoBatch(d, r.batch, T0), { kind: "expired" }, "a second Fortryd has nothing left");

  const w2 = await world();
  const d2 = deps(w2);
  const r2 = await approveAll(d2, clips(w2), clock());
  assert.deepEqual(await undoBatch(d2, r2.batch, new Date(r2.deadline!)), { kind: "expired" }, "at the deadline the cuts stay");
  await finishBatch(d2, r2.done, new Date(r2.deadline!));
  assert.deepEqual(await undoBatch(d2, r2.batch, T0), { kind: "expired" }, "after the finish: nothing pending");
});

test("undoBatch touches only its own batch: a clip pending in another batch is not undone", async () => {
  const w = await world();
  const d = deps(w);
  const r = await approveAll(d, clips(w), clock());
  const other = IDS[0];
  const e = await w.index.get(other);
  await w.index.put({ ...e!, pendingTrim: { ...e!.pendingTrim!, batch: "batch-2" } });
  const u = await undoBatch(d, r.batch, T0);
  assert.equal(u.kind, "undone");
  if (u.kind === "undone") assert.equal(u.restored.includes(other), false);
  assert.equal((await w.index.get(other))?.pendingTrim?.batch, "batch-2");
});

/** Every storage, cut and server step counted; from step `dieAt` on each throws (the page died, or the connection is cut). */
function dying(w: World, dieAt: number): { deps: ApproveDeps; steps: () => number } {
  let n = 0;
  const step = (): void => {
    n += 1;
    if (n >= dieAt) throw new Error(`died at ${n}`);
  };
  const wrap = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
    step();
    return f(...a);
  };
  const index: ClipIndex = { all: wrap(w.index.all), get: wrap(w.index.get), put: wrap(w.index.put), remove: wrap(w.index.remove) };
  const files: ClipFiles = { ...w.files, readFile: wrap(w.files.readFile), writeFile: wrap(w.files.writeFile), removeFile: wrap(w.files.removeFile), names: wrap(w.files.names) };
  return { deps: deps(w, { index, files, trim: wrap(serverTrim(w)), cut: wrap(fakeCut) }), steps: () => n };
}

test("failure injection: die at every step of the batch and its finish, reload: every clip is untouched or fully cut, never without a file", async () => {
  const run = async (w: World, dieAt: number): Promise<number> => {
    const { deps: dd, steps } = dying(w, dieAt);
    const r = await approveAll(dd, clips(w), clock());
    if (r.deadline !== null) await finishBatch(dd, r.done, new Date(r.deadline));
    return steps();
  };
  const total = await run(await world(), Infinity); // the steps of a run that never dies
  for (let dieAt = 1; dieAt <= total; dieAt += 1) {
    const w = await world();
    await run(w, dieAt);
    // reload: healthy storage, past every deadline, twice (a finish that fails is retried)
    const healthy = deps(w);
    await finishDueTrims(healthy, at(60 * 60_000));
    await finishDueTrims(healthy, at(61 * 60_000));
    const entries = await w.index.all();
    const names = await w.files.names();
    assert.deepEqual(trimInvariant(entries, names), [], `dieAt ${dieAt}`);
    for (const [i, id] of IDS.entries()) {
      const e = entries.find((x) => x.id === id)!;
      const own = names.filter((x) => x.startsWith(id));
      assert.equal(own.length, 1, `dieAt ${dieAt}: ${id} has one file, not ${own.length}`);
      assert.equal(e.pendingTrim, undefined, `dieAt ${dieAt}: ${id} finished`);
      const cut = clipFile(e) === `${id}.cut.mp4`;
      if (cut) {
        assert.equal(w.rows.get(id)?.durationS, e.durationS, `dieAt ${dieAt}: ${id} cut on the server too`);
        assert.equal(w.accuracy.filter((a) => a.clip_id === id).length, 1, `dieAt ${dieAt}: one approved row`);
      } else {
        assert.equal(clipFile(e), `${id}.mp4`, `dieAt ${dieAt}`);
        assert.deepEqual(await bytes(w.files, `${id}.mp4`), [...originalBytes(i)], `dieAt ${dieAt}: ${id} untouched`);
        assert.equal(w.rows.get(id)?.durationS, 50, `dieAt ${dieAt}: ${id} untouched on the server`);
      }
    }
    assert.ok(w.accuracy.every((a) => a.kind === "approved"));
  }
  assert.ok(Number.isFinite(total) && total > 20, `the batch and finish have ${total} steps`);
});

// --- review fixes ----------------------------------------------------------------------------------

test("race: a Gem klip in the player while the batch runs; the batch then skips that clip and leaves the user's cut and its Fortryd alone", async () => {
  const w = await world();
  const lock = memoryLock();
  const user = IDS[1];
  const list = clips(w); // the batch's list, read at the tap: all three are untouched originals
  assert.equal(list.length, 3);
  let own: Awaited<ReturnType<typeof startTrim>> | null = null;
  // while the batch cuts its first clip (under that clip's lock), the user saves an own range on another
  const cut: ApproveDeps["cut"] = async (file, i, o) => {
    if (own === null) own = await startTrim({ index: w.index, files: w.files, trim: serverTrim(w), cut: fakeCut, lock }, user, 10, 30, at(500), "own");
    return fakeCut(file, i, o);
  };
  const r = await approveAll(deps(w, { cut, lock }), list, clock());
  assert.equal(own!.kind, "done");
  assert.deepEqual(r.failed, [{ id: user, space: false, notOriginal: true }], "skipped: no longer the untouched original");
  assert.equal(r.done.length, 2);
  const e = await w.index.get(user);
  assert.deepEqual([e?.pendingTrim?.kind, e?.pendingTrim?.inS, e?.pendingTrim?.outS, e?.pendingTrim?.batch], ["own", 10, 30, undefined], "the user's range, never the auto range");
  assert.equal(e?.pendingTrim?.deadline, at(500 + TRIM_UNDO_MS).toISOString(), "its own deadline, not the batch's");
  assert.equal(w.calls, 0, "nothing force-finished, nothing sent");
  assert.deepEqual(pendingTrimBatches(await w.index.all()).map((b) => b.ids.includes(user)), [false]);
  const u = await undoTrim({ index: w.index, files: w.files, lock }, user, at(1000));
  assert.equal(u.kind, "undone", "the user's Fortryd still works");
  assert.deepEqual(await bytes(w.files, `${user}.mp4`), [...originalBytes(1)]);
  assert.deepEqual(trimInvariant(await w.index.all(), await w.files.names()), []);
});

test("startTrim onlyOriginal: a pending cut, a finished cut or a pending delete is not_original and untouched; without it a pending cut is still finished first", async () => {
  const pending = { deadline: at(TRIM_UNDO_MS).toISOString(), originalFileName: `${IDS[0]}.mp4`, originalDurationS: 50, newDurationS: 30, inS: 10, outS: 30, kind: "own" as const };
  const cases: { name: string; over: Partial<ClipIndexEntry> }[] = [
    { name: "a cut pending", over: { fileName: `${IDS[0]}.cut.mp4`, durationS: 30, pendingTrim: pending } },
    { name: "already cut", over: { fileName: `${IDS[0]}.cut.mp4`, durationS: 30 } },
    { name: "a delete pending", over: { pendingDelete: { deadline: at(TRIM_UNDO_MS).toISOString(), batch: "d" } } },
  ];
  for (const c of cases) {
    const w = await world();
    await w.files.writeFile(`${IDS[0]}.cut.mp4`, new Blob([originalBytes(0).slice(0, 30)]));
    const before = entry(IDS[0], c.over);
    await w.index.put(before);
    const r = await startTrim(deps(w), IDS[0], 4.2, 39.6, at(1000), "approved", { batch: "b", onlyOriginal: true });
    assert.deepEqual(r, { kind: "failed", space: false, reason: "not_original" }, c.name);
    assert.deepEqual(await w.index.get(IDS[0]), before, `${c.name}: entry untouched`);
    assert.equal(w.calls, 0, `${c.name}: no finish sent`);
  }
  const w = await world();
  await w.files.writeFile(`${IDS[0]}.cut.mp4`, new Blob([originalBytes(0).slice(0, 30)]));
  await w.index.put(entry(IDS[0], cases[0].over));
  const r = await startTrim(deps(w), IDS[0], 4.2, 20, at(1000), "own");
  assert.equal(r.kind, "done", "Gem klip in the player keeps its second-cut behaviour");
  assert.equal(w.calls, 1, "the first cut was finished first");
});

test("batchGuard: a double tap starts one batch; current is the running batch until it ends", async () => {
  const g = batchGuard();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let runs = 0;
  const first = g.run("b1", async () => {
    runs += 1;
    await gate;
    return "one";
  });
  assert.equal(g.current(), "b1", "set synchronously at the tap");
  assert.equal(await g.run("b2", async () => ((runs += 1), "two")), null, "the second tap does nothing");
  release();
  assert.equal(await first, "one");
  assert.equal(runs, 1);
  assert.equal(g.current(), null);
  await assert.rejects(g.run("b3", async () => Promise.reject(new Error("x"))));
  assert.equal(g.current(), null, "a throw frees it");
});

test("rearmableBatches: a page coming back mid-batch leaves the running batch's clips alone, re-arms the others", async () => {
  const w = await world();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let n = 0;
  const cut: ApproveDeps["cut"] = async (file, i, o) => {
    if ((n += 1) === 2) await gate; // hold the batch on its second clip
    return fakeCut(file, i, o);
  };
  const running = approveAll(deps(w, { cut, newBatch: () => "batch-run" }), clips(w), clock());
  while (n < 2) await new Promise((r) => setTimeout(r, 0));
  const mid = await w.index.all();
  assert.equal(pendingTrimBatches(mid).length, 1, "the first clip is cut and pending");
  assert.deepEqual(rearmableBatches(mid, "batch-run"), [], "visible again mid-batch: no timer for it");
  const older = { deadline: at(5000).toISOString(), originalFileName: "o.mp4", originalDurationS: 50, newDurationS: 30, batch: "batch-old" };
  assert.deepEqual(rearmableBatches([...mid, entry("old", { pendingTrim: older })], "batch-run").map((b) => b.batch), ["batch-old"], "an older batch still re-arms");
  assert.deepEqual(rearmableBatches(mid, null).map((b) => b.batch), ["batch-run"], "after the batch: re-armed as before");
  release();
  await running;
});
