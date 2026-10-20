import assert from "node:assert/strict";
import { test } from "node:test";

import type { SetClipAutoInput, SetClipAutoResult } from "../src/lib/video/auto-clip.ts";
import { clipFile, clipFiles, type ClipIndex, type ClipIndexEntry, memoryClipIndex } from "../src/lib/video/index-store.ts";
import { type ClipFiles, memoryClipFiles } from "../src/lib/video/opfs.ts";
import {
  type CutResult,
  finishDueTrims,
  finishTrim,
  guardAutoWrite,
  nextCutName,
  startTrim,
  strayFiles,
  TRIM_UNDO_MS,
  type TrimClipResult,
  type TrimDeps,
  trimInvariant,
  undoTrim,
  validateTrim,
} from "../src/lib/video/trim.ts";

const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
const T0 = new Date("2026-10-20T16:00:00.000Z");
const at = (ms: number): Date => new Date(T0.getTime() + ms);
const ORIGINAL = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));

const entry = (over: Partial<ClipIndexEntry> = {}): ClipIndexEntry => ({
  id: ID,
  setKey: { date: "2026-10-20", sessionNo: 1, row: 30, set: 1 },
  ext: "mp4",
  recordedAt: "2026-10-20T15:55:00.000Z",
  durationS: 51.8,
  starred: false,
  starSynced: true,
  state: "done",
  ...over,
});

/** A file's own length (s), as the player would measure it. */
const seconds = new WeakMap<Blob, number>();

/** The fixture's cut (clip-trim §6): the keyframe before 12.3 is 11.8, so [12.3, 48.0] gives 36.2 s. */
async function fakeCut(file: Blob, inS: number, outS: number): Promise<CutResult> {
  const startS = Math.round((inS - 0.5) * 10) / 10; // the keyframe at or before in
  const bytes = new Uint8Array(await file.arrayBuffer()).slice(20, 80);
  const blob = new Blob([bytes]);
  seconds.set(blob, outS - startS);
  return { blob, actual: { startS, endS: outS } };
}

type World = { index: ClipIndex; files: ClipFiles; server: { durationS: number; calls: number } };

async function world(): Promise<World> {
  const index = memoryClipIndex([entry()]);
  const files = memoryClipFiles();
  const original = new Blob([ORIGINAL]);
  seconds.set(original, 51.8);
  await files.writeFile(`${ID}.mp4`, original);
  return { index, files, server: { durationS: 51.8, calls: 0 } };
}

/** The server's rule (validateTrim against its row), one call counted per request. */
function serverTrim(w: World): TrimDeps["trim"] {
  return async (input) => {
    w.server.calls += 1;
    const d = validateTrim(input.durationS, w.server.durationS);
    if (d === null) return { ok: false, reason: "duration" };
    w.server.durationS = d;
    return { ok: true, dev: false, durationS: d };
  };
}

const deps = (w: World): TrimDeps => ({ index: w.index, files: w.files, trim: serverTrim(w), cut: fakeCut });

async function bytesOf(files: ClipFiles, name: string): Promise<number[] | null> {
  const b = await files.readFile(name);
  return b === null ? null : [...new Uint8Array(await b.arrayBuffer())];
}

test("clipFile: an old entry is <id>.<ext>; a new one names its file; clipFiles adds a pending original", () => {
  assert.equal(clipFile(entry()), `${ID}.mp4`);
  assert.equal(clipFile(entry({ ext: "webm" })), `${ID}.webm`);
  assert.equal(clipFile(entry({ fileName: `${ID}.cut.mp4` })), `${ID}.cut.mp4`);
  assert.deepEqual(clipFiles(entry()), [`${ID}.mp4`]);
  const pending = entry({ fileName: `${ID}.cut.mp4`, pendingTrim: { deadline: T0.toISOString(), originalFileName: `${ID}.mp4`, originalDurationS: 51.8, newDurationS: 36.2 } });
  assert.deepEqual(clipFiles(pending), [`${ID}.cut.mp4`, `${ID}.mp4`]);
  assert.equal(nextCutName(entry()), `${ID}.cut.mp4`);
  assert.equal(nextCutName(entry({ fileName: `${ID}.cut.mp4` })), `${ID}.mp4`, "a second cut writes the other name");
});

test("happy path: Gem klip makes the cut the clip with Fortryd for 10 s; at 0 one PATCH, the original goes, pending cleared last", async () => {
  const w = await world();
  const d = deps(w);
  const r = await startTrim(d, ID, 12.3, 48.0, T0);
  assert.equal(r.kind, "done");
  if (r.kind !== "done") return;
  assert.deepEqual({ from: r.fromS, to: r.toS, deadline: r.deadline }, { from: 51.8, to: 36.2, deadline: at(TRIM_UNDO_MS).toISOString() });
  const e = await w.index.get(ID);
  assert.equal(e?.fileName, `${ID}.cut.mp4`);
  assert.equal(e?.durationS, 36.2);
  assert.deepEqual(e?.pendingTrim, { deadline: r.deadline, originalFileName: `${ID}.mp4`, originalDurationS: 51.8, newDurationS: 36.2 });
  assert.deepEqual((await w.files.names()).toSorted(), [`${ID}.cut.mp4`, `${ID}.mp4`]);
  assert.deepEqual(trimInvariant(await w.index.all(), await w.files.names()), []);
  assert.equal(w.server.calls, 0, "never a server write during the window");
  assert.equal(await finishTrim(d, ID, at(9_999)), "waiting");
  assert.equal(w.server.calls, 0);
  assert.equal(await finishTrim(d, ID, at(TRIM_UNDO_MS)), "done");
  assert.equal(w.server.calls, 1, "exactly one server write per cut");
  const done = await w.index.get(ID);
  assert.equal(done?.pendingTrim, undefined);
  assert.deepEqual(await w.files.names(), [`${ID}.cut.mp4`]);
  const file = await w.files.readFile(clipFile(done ?? entry()));
  assert.ok(file !== null && Math.abs((seconds.get(file) ?? 0) - w.server.durationS) < 0.1, "the server's duration is the file's own");
  assert.equal(done?.durationS, w.server.durationS);
  assert.deepEqual(trimInvariant(await w.index.all(), await w.files.names()), []);
});

test("Fortryd at 9 s: the original comes back byte for byte, the cut is deleted, no server call; at 10 s it is too late", async () => {
  const w = await world();
  const d = deps(w);
  await startTrim(d, ID, 12.3, 48.0, T0);
  const u = await undoTrim(d, ID, at(9_000));
  assert.equal(u.kind, "undone");
  assert.deepEqual(await bytesOf(w.files, `${ID}.mp4`), [...ORIGINAL]);
  assert.deepEqual(await w.files.names(), [`${ID}.mp4`]);
  const e = await w.index.get(ID);
  assert.deepEqual({ file: e === null ? null : clipFile(e), d: e?.durationS, p: e?.pendingTrim }, { file: `${ID}.mp4`, d: 51.8, p: undefined });
  await finishDueTrims(d, at(60_000));
  assert.equal(w.server.calls, 0, "Fortryd is local only");
  assert.equal(w.server.durationS, 51.8);

  const w2 = await world();
  await startTrim(deps(w2), ID, 12.3, 48.0, T0);
  assert.deepEqual(await undoTrim(deps(w2), ID, at(TRIM_UNDO_MS)), { kind: "expired" });
  assert.deepEqual(await undoTrim(deps(w2), "11111111-1111-4111-8111-111111111111", T0), { kind: "none" });
});

test("the deadline reached while closed: the next load finishes; before it, the load leaves the window open", async () => {
  const w = await world();
  await startTrim(deps(w), ID, 12.3, 48.0, T0);
  // the page closes; a new mount has new deps over the same storage
  assert.deepEqual(await finishDueTrims(deps(w), at(5_000)), { finished: [], failed: [], pending: [ID] });
  assert.equal(w.server.calls, 0);
  assert.deepEqual(await finishDueTrims(deps(w), at(3_600_000)), { finished: [ID], failed: [], pending: [] });
  assert.equal(w.server.calls, 1);
  assert.deepEqual(await w.files.names(), [`${ID}.cut.mp4`]);
  assert.equal(w.server.durationS, 36.2);
  assert.deepEqual(trimInvariant(await w.index.all(), await w.files.names()), []);
});

type Op = "writeFile" | "removeFile" | "put" | "trim";

/** Breaks the k-th mutating step (before it applies, or after: a lost reply), counting across the run. */
function faulty(w: World, k: number, afterApply: boolean): TrimDeps & { readonly steps: () => Op[] } {
  const seen: Op[] = [];
  const step = async <T>(op: Op, run: () => Promise<T>): Promise<T> => {
    seen.push(op);
    if (seen.length === k && !afterApply) throw new Error(`cut at ${op}`);
    const v = await run();
    if (seen.length === k) throw new Error(`lost reply at ${op}`);
    return v;
  };
  const files: ClipFiles = {
    ...w.files,
    writeFile: (n, b) => step("writeFile", () => w.files.writeFile(n, b)),
    removeFile: (n) => step("removeFile", () => w.files.removeFile(n)),
  };
  const index: ClipIndex = { ...w.index, put: (e) => step("put", () => w.index.put(e)) };
  const trim = serverTrim(w);
  return { index, files, trim: (i) => step("trim", () => trim(i)), cut: fakeCut, steps: () => [...seen] };
}

test("failure injection: a break at every step, then a reload, ends untouched or fully done, never 0 files or 2", async () => {
  const clean = await world();
  const all = faulty(clean, Number.POSITIVE_INFINITY, false);
  await startTrim(all, ID, 12.3, 48.0, T0);
  await finishTrim(all, ID, at(TRIM_UNDO_MS));
  assert.deepEqual(all.steps(), ["writeFile", "put", "trim", "removeFile", "put"], "the cut write, the index, the PATCH, the original's delete, the clear");
  for (const afterApply of [false, true]) {
    for (let k = 1; k <= all.steps().length; k++) {
      const label = `${afterApply ? "lost reply" : "cut"} at step ${k} (${all.steps()[k - 1]})`;
      const w = await world();
      const d = faulty(w, k, afterApply);
      await startTrim(d, ID, 12.3, 48.0, T0);
      await finishTrim(d, ID, at(TRIM_UNDO_MS));
      // in between: the index names a file that exists; the original exists until the PATCH landed
      const mid = await w.index.all();
      for (const e of mid) assert.ok((await w.files.names()).includes(clipFile(e)), `${label}: the index names an existing file`);
      if (w.server.calls === 0 || w.server.durationS === 51.8) assert.ok((await w.files.names()).includes(`${ID}.mp4`), `${label}: the original stays until the PATCH landed`);
      // reload, past the deadline, nothing broken
      await finishDueTrims(deps(w), at(TRIM_UNDO_MS + 60_000));
      const names = (await w.files.names()).toSorted();
      const e = await w.index.get(ID);
      assert.ok(e !== null, label);
      assert.deepEqual(trimInvariant(await w.index.all(), names), [], label);
      assert.equal(names.length, 1, `${label}: exactly one file (${names.join(", ")})`);
      assert.equal(e.pendingTrim, undefined, `${label}: finished`);
      const untouched = names[0] === `${ID}.mp4`;
      if (untouched) {
        assert.deepEqual(await bytesOf(w.files, `${ID}.mp4`), [...ORIGINAL], `${label}: the original byte for byte`);
        assert.deepEqual({ d: e.durationS, s: w.server.durationS, f: clipFile(e) }, { d: 51.8, s: 51.8, f: `${ID}.mp4` }, label);
      } else {
        assert.equal(names[0], `${ID}.cut.mp4`, label);
        const file = await w.files.readFile(clipFile(e));
        assert.ok(file !== null, label);
        assert.equal(w.server.durationS, e.durationS, `${label}: the server's duration is the entry's`);
        assert.ok(Math.abs((seconds.get(file) ?? 0) - w.server.durationS) < 0.1, `${label}: and the file's`);
      }
    }
  }
});

test("a failed cut, an unreadable original, or no space leave the original untouched; a second cut finishes the first", async () => {
  const w = await world();
  const failing: TrimDeps = { ...deps(w), cut: async () => Promise.reject(new Error("codec")) };
  assert.deepEqual(await startTrim(failing, ID, 12.3, 48.0, T0), { kind: "failed", space: false });
  const full: TrimDeps = { ...deps(w), files: { ...w.files, writeFile: async () => Promise.reject(new DOMException("full", "QuotaExceededError")) } };
  assert.deepEqual(await startTrim(full, ID, 12.3, 48.0, T0), { kind: "failed", space: true });
  assert.deepEqual(await w.files.names(), [`${ID}.mp4`]);
  assert.deepEqual(await bytesOf(w.files, `${ID}.mp4`), [...ORIGINAL]);
  assert.equal((await w.index.get(ID))?.pendingTrim, undefined);

  const r1 = await startTrim(deps(w), ID, 12.3, 48.0, T0);
  assert.equal(r1.kind, "done");
  const r2 = await startTrim(deps(w), ID, 2.2, 30.0, at(3_000)); // inside the first's window
  assert.equal(r2.kind, "done");
  assert.equal(w.server.calls, 1, "the first cut was committed before the second");
  assert.deepEqual((await w.files.names()).toSorted(), [`${ID}.cut.mp4`, `${ID}.mp4`]);
  assert.equal((await w.index.get(ID))?.fileName, `${ID}.mp4`, "the second cut takes the free name");
  await finishDueTrims(deps(w), at(60_000));
  assert.deepEqual(await w.files.names(), [`${ID}.mp4`]);
  assert.equal(w.server.durationS, 28.3);
});

test("strayFiles and trimInvariant: a cut no entry names is swept; a missing file is a violation; other ids are left alone", () => {
  const e = entry();
  assert.deepEqual(strayFiles([e], [`${ID}.mp4`, `${ID}.cut.mp4`, "other.mp4"]), [`${ID}.cut.mp4`]);
  assert.deepEqual(trimInvariant([e], [`${ID}.mp4`]), []);
  assert.equal(trimInvariant([e], []).length, 1);
  const pending = entry({ fileName: `${ID}.cut.mp4`, pendingTrim: { deadline: T0.toISOString(), originalFileName: `${ID}.mp4`, originalDurationS: 51.8, newDurationS: 36.2 } });
  assert.deepEqual(trimInvariant([pending], [`${ID}.cut.mp4`, `${ID}.mp4`]), []);
  assert.equal(trimInvariant([pending], [`${ID}.cut.mp4`]).length, 1, "the original gone while pending");
});

test("the parked automatic clip sends no setClipAuto for a clip with a pending cut", async () => {
  let sent = 0;
  const send = async (): Promise<SetClipAutoResult> => {
    sent += 1;
    return { ok: false, reason: "failed" };
  };
  const input: SetClipAutoInput = { id: ID, status: "failed", inS: null, outS: null, runMs: 1 };
  const pending = entry({ pendingTrim: { deadline: T0.toISOString(), originalFileName: `${ID}.mp4`, originalDurationS: 51.8, newDurationS: 36.2 } });
  assert.deepEqual(await guardAutoWrite(send, memoryClipIndex([pending]))(input), { ok: false, reason: "not_allowed" });
  assert.equal(sent, 0);
  await guardAutoWrite(send, memoryClipIndex([entry()]))(input);
  assert.equal(sent, 1);
});

test("a trimClip refusal leaves the cut pending for the next load", async () => {
  const w = await world();
  await startTrim(deps(w), ID, 12.3, 48.0, T0);
  const down: TrimDeps = { ...deps(w), trim: async (): Promise<TrimClipResult> => ({ ok: false, reason: "failed" }) };
  assert.equal(await finishTrim(down, ID, at(TRIM_UNDO_MS)), "failed");
  assert.deepEqual((await w.files.names()).toSorted(), [`${ID}.cut.mp4`, `${ID}.mp4`]);
  assert.notEqual((await w.index.get(ID))?.pendingTrim, undefined);
  assert.equal(await finishTrim(deps(w), ID, at(TRIM_UNDO_MS)), "done");
});
