import assert from "node:assert/strict";
import { test } from "node:test";

import type { DeleteClipResult } from "../src/lib/video/clips.ts";
import { cleanupPlan } from "../src/lib/video/cleanup.ts";
import {
  DELETE_UNDO_MS,
  type DeleteDeps,
  deleteDoneLine,
  deleteFailedLine,
  deleteInvariant,
  deleteUndoneLine,
  deleteWindowText,
  finishDelete,
  finishDueDeletes,
  markSaved,
  notPendingDelete,
  savedDeletable,
  secondsLeft,
  shareMarksSaved,
  startDelete,
  undoDelete,
} from "../src/lib/video/delete.ts";
import { clipFile, type ClipIndex, type ClipIndexEntry, memoryClipIndex } from "../src/lib/video/index-store.ts";
import { libraryRows } from "../src/lib/video/library-view.ts";
import { type ClipFiles, memoryClipFiles } from "../src/lib/video/opfs.ts";
import { shareClip } from "../src/lib/video/share.ts";
import { type CutResult, finishTrim, memoryLock, startTrim, type TrimDeps } from "../src/lib/video/trim.ts";

const A = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";
const B = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ac";
const T0 = new Date("2026-10-20T16:00:00.000Z");
const at = (ms: number): Date => new Date(T0.getTime() + ms);
const NAMES = { exercises: {}, variants: {} };

const entry = (id: string, over: Partial<ClipIndexEntry> = {}): ClipIndexEntry => ({
  id,
  setKey: { date: "2026-10-20", sessionNo: 1, row: 30, set: 1 },
  ext: "mp4",
  recordedAt: "2026-10-20T15:55:00.000Z",
  durationS: 51.8,
  starred: false,
  starSynced: true,
  state: "done",
  ...over,
});

type World = { index: ClipIndex; files: ClipFiles; calls: string[]; deps: DeleteDeps };

async function world(entries: ClipIndexEntry[], del?: (id: string) => Promise<DeleteClipResult>): Promise<World> {
  const index = memoryClipIndex(entries);
  const files = memoryClipFiles();
  for (const e of entries) await files.writeFile(clipFile(e), new Blob([new Uint8Array(10)]));
  const calls: string[] = [];
  const deps: DeleteDeps = {
    index,
    files,
    lock: memoryLock(),
    del: async ({ id }) => {
      calls.push(id);
      return del === undefined ? { ok: true, dev: false } : del(id);
    },
  };
  return { index, files, calls, deps };
}

const listed = async (w: World) => libraryRows(await w.index.all(), [], NAMES).map((r) => r.id);

test("Slet marks the entry: the clip leaves the list at once, file and entry stay", async () => {
  const w = await world([entry(A), entry(B)]);
  const r = await startDelete(w.deps, [A], "b1", T0);
  assert.equal(r.marked.length, 1);
  assert.equal(r.deadline, at(DELETE_UNDO_MS).toISOString());
  assert.deepEqual(await listed(w), [B]);
  assert.notEqual(await w.index.get(A), null);
  assert.deepEqual((await w.files.names()).sort(), [`${A}.mp4`, `${B}.mp4`]);
  assert.deepEqual(w.calls, []);
});

test("a pending clip's server row never shows as fil mangler", async () => {
  const w = await world([entry(A)]);
  await startDelete(w.deps, [A], "b1", T0);
  const row = { id: A, date: "2026-10-20", session: 1, row: 30, set: 1, exerciseId: 1, variantId: null, recordedAt: "2026-10-20T15:55:00.000Z", durationS: 51.8, starred: false, clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null } as const;
  assert.deepEqual(libraryRows(await w.index.all(), [row], NAMES), []);
});

test("Fortryd inside the window restores the row, the same file and gemt ✓, with no server write", async () => {
  const w = await world([entry(A, { savedOut: true })]);
  await startDelete(w.deps, [A], "b1", T0);
  const back = await undoDelete(w.deps, [A], "b1", at(9_000));
  assert.equal(back.length, 1);
  assert.deepEqual(await listed(w), [A]);
  assert.equal((await w.index.get(A))?.savedOut, true);
  assert.equal((await w.index.get(A))?.pendingDelete, undefined);
  assert.deepEqual(await w.files.names(), [`${A}.mp4`]);
  assert.equal(await finishDelete(w.deps, A, at(20_000)), "done"); // nothing pending: no DELETE
  assert.deepEqual(w.calls, []);
  assert.deepEqual(await w.files.names(), [`${A}.mp4`]);
});

test("Fortryd after the deadline, or of another batch, restores nothing", async () => {
  const w = await world([entry(A)]);
  await startDelete(w.deps, [A], "b1", T0);
  assert.deepEqual(await undoDelete(w.deps, [A], "b1", at(DELETE_UNDO_MS)), []);
  assert.deepEqual(await undoDelete(w.deps, [A], "other", at(1_000)), []);
  assert.deepEqual(await listed(w), []);
});

test("at the deadline: one DELETE, then the file, then the entry", async () => {
  const order: string[] = [];
  const w = await world([entry(A)]);
  const files = w.files;
  const index = w.index;
  const deps: DeleteDeps = {
    ...w.deps,
    del: async ({ id }) => {
      order.push(`delete ${id}`);
      return { ok: true, dev: false };
    },
    files: { ...files, removeFile: async (n) => (order.push(`file ${n}`), files.removeFile(n)) },
    index: { ...index, remove: async (id) => (order.push(`entry ${id}`), index.remove(id)) },
  };
  await startDelete(deps, [A], "b1", T0);
  assert.equal(await finishDelete(deps, A, at(5_000)), "waiting");
  assert.equal(order.length, 0);
  assert.equal(await finishDelete(deps, A, at(DELETE_UNDO_MS)), "done");
  assert.deepEqual(order, [`delete ${A}`, `file ${A}.mp4`, `entry ${A}`]);
  assert.equal(await finishDelete(deps, A, at(DELETE_UNDO_MS + 1)), "done"); // never twice
  assert.equal(order.filter((o) => o.startsWith("delete")).length, 1);
});

test("a reload inside the window keeps the row hidden and finishes after the deadline", async () => {
  const w = await world([entry(A)]);
  await startDelete(w.deps, [A], "b1", T0);
  // reload: a new view of the same stores
  const early = await finishDueDeletes(w.deps, at(3_000));
  assert.deepEqual(early.pending.map((e) => e.id), [A]);
  assert.deepEqual(await listed(w), []);
  const late = await finishDueDeletes(w.deps, at(11_000));
  assert.deepEqual(late.finished, [A]);
  assert.deepEqual(w.calls, [A]);
  assert.deepEqual(await w.files.names(), []);
  assert.equal(await w.index.get(A), null);
});

test("a failed DELETE leaves file and entry, hidden, and the next load retries", async () => {
  let fail = true;
  const w = await world([entry(A)], async () => (fail ? { ok: false, reason: "failed" } : { ok: true, dev: false }));
  await startDelete(w.deps, [A], "b1", T0);
  assert.equal(await finishDelete(w.deps, A, at(11_000)), "failed");
  assert.deepEqual(await w.files.names(), [`${A}.mp4`]);
  assert.notEqual(await w.index.get(A), null);
  assert.deepEqual(await listed(w), []);
  fail = false;
  assert.deepEqual((await finishDueDeletes(w.deps, at(60_000))).finished, [A]);
  assert.deepEqual(await w.files.names(), []);
  assert.equal(await w.index.get(A), null);
});

test("a thrown DELETE (the network) counts as failed", async () => {
  const w = await world([entry(A)], async () => {
    throw new Error("offline");
  });
  await startDelete(w.deps, [A], "b1", T0);
  assert.equal(await finishDelete(w.deps, A, at(11_000)), "failed");
  assert.deepEqual(await w.files.names(), [`${A}.mp4`]);
});

test("a pending cut: both files go", async () => {
  const e = entry(A, { fileName: `${A}.cut.mp4`, pendingTrim: { deadline: at(5_000).toISOString(), originalFileName: `${A}.mp4`, originalDurationS: 51.8, newDurationS: 20 } });
  const w = await world([e]);
  await w.files.writeFile(`${A}.mp4`, new Blob([new Uint8Array(10)]));
  await startDelete(w.deps, [A], "b1", T0);
  assert.equal(await finishDelete(w.deps, A, at(11_000)), "done");
  assert.deepEqual(await w.files.names(), []);
});

// Failure injection: break the run at each step, reload (a fresh finishDueDeletes on the same stores), and check
// the end state is untouched or fully deleted, never a listed clip without a file, nor a file without an entry.
const STEPS = ["mark", "delete", "file", "entry"] as const;
for (const step of STEPS) {
  test(`failure injection: cut at ${step}, then reload`, async () => {
    const base = await world([entry(A)]);
    let broken = true;
    const cut = (s: (typeof STEPS)[number]) => {
      if (broken && step === s) throw new Error(`cut at ${s}`);
    };
    const deps: DeleteDeps = {
      ...base.deps,
      index: {
        ...base.index,
        put: async (e) => (cut("mark"), base.index.put(e)),
        remove: async (id) => (cut("entry"), base.index.remove(id)),
      },
      files: { ...base.files, removeFile: async (n) => (cut("file"), base.files.removeFile(n)) },
      del: async (i) => (cut("delete"), base.deps.del(i)),
    };
    try {
      await startDelete(deps, [A], "b1", T0);
    } catch {
      // the mark failed: nothing happened
    }
    try {
      await finishDelete(deps, A, at(11_000));
    } catch {
      // a cut mid-run
    }
    const check = async () => {
      const entries = await base.index.all();
      const names = await base.files.names();
      assert.deepEqual(deleteInvariant(entries, names, [A]), []);
      for (const id of libraryRows(entries, [], NAMES).map((r) => r.id)) assert.ok(names.includes(`${id}.mp4`), "a listed clip has its file");
    };
    await check();
    broken = false;
    await finishDueDeletes(base.deps, at(60_000)); // reload
    await check();
    const after = await base.index.get(A);
    if (step === "mark") {
      assert.notEqual(after, null, "untouched");
      assert.equal(after?.pendingDelete, undefined);
      assert.deepEqual(await base.files.names(), [`${A}.mp4`]);
      assert.deepEqual(base.calls, []);
    } else {
      assert.equal(after, null, "fully deleted");
      assert.deepEqual(await base.files.names(), []);
      assert.ok(base.calls.length >= 1);
    }
  });
}

test("gemt ✓: set by a download and by a resolved share, never by a cancelled one", async () => {
  const w = await world([entry(A), entry(B)]);
  await markSaved(w.deps, [A]); // Gem / Gem alle
  assert.equal((await w.index.get(A))?.savedOut, true);
  const data = { files: [] } as ShareData;
  const shared = await shareClip({ canShare: () => true, share: async () => undefined }, data);
  const cancelled = await shareClip(
    {
      canShare: () => true,
      share: async () => {
        throw new DOMException("closed", "AbortError");
      },
    },
    data,
  );
  assert.equal(shareMarksSaved(shared), true);
  assert.equal(shareMarksSaved(cancelled), false);
  assert.equal(shareMarksSaved("failed"), false);
  assert.equal(shareMarksSaved("unsupported"), false);
  const rows = libraryRows(await w.index.all(), [], NAMES);
  assert.equal(rows.find((r) => r.id === A)?.saved, true);
  assert.equal(rows.find((r) => r.id === B)?.saved, false);
});

test("Slet gemte selects gemt ✓ ∧ ¬★ ∧ ¬pending, and its Fortryd restores the whole batch", async () => {
  const C = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ad";
  const D = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ae";
  const w = await world([
    entry(A, { savedOut: true }),
    entry(B, { savedOut: true, starred: true }),
    entry(C),
    entry(D, { savedOut: true, pendingDelete: { deadline: at(5_000).toISOString(), batch: "old" } }),
  ]);
  const pick = savedDeletable(await w.index.all()).map((e) => e.id);
  assert.deepEqual(pick, [A]);
  await startDelete(w.deps, pick, "b2", T0);
  assert.deepEqual(savedDeletable(await w.index.all()), []); // count 0: the button goes
  assert.deepEqual((await undoDelete(w.deps, pick, "b2", at(1_000))).map((e) => e.id), [A]);
  assert.equal((await w.index.get(D))?.pendingDelete?.batch, "old"); // the older batch runs on
});

test("a delete never races a concurrent trim: the lock serialises them, both files go", async () => {
  const w = await world([entry(A)]);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const cut = async (): Promise<CutResult> => {
    await gate;
    return { blob: new Blob([new Uint8Array(5)]), actual: { startS: 1, endS: 21 } };
  };
  const trimDeps: TrimDeps = { index: w.index, files: w.files, lock: w.deps.lock, trim: async (i) => ({ ok: true, dev: false, durationS: i.durationS }), cut };
  const trimming = startTrim(trimDeps, A, 1, 21, T0);
  const marking = startDelete(w.deps, [A], "b1", T0);
  release();
  const t = await trimming;
  await marking;
  assert.equal(t.kind, "done");
  const e = await w.index.get(A);
  assert.equal(e?.pendingDelete?.batch, "b1", "the mark landed on the trimmed entry");
  assert.equal(e?.pendingTrim !== undefined, true);
  assert.equal(await finishDelete(w.deps, A, at(11_000)), "done");
  assert.deepEqual(await w.files.names(), [], "the cut and the original both gone");
  assert.equal(await finishTrim(trimDeps, A, at(12_000)), "done"); // a late trim timer finds nothing
  assert.deepEqual(await w.files.names(), []);
});

test("the 8-week cleanup plans over non-pending entries only and never a ★", () => {
  const old = "2026-08-01T10:00:00.000Z";
  const pending = entry(A, { recordedAt: old, pendingDelete: { deadline: at(5_000).toISOString(), batch: "b" } });
  const starred = entry(B, { recordedAt: old, starred: true });
  const plan = cleanupPlan([pending, starred], [], T0);
  assert.deepEqual(notPendingDelete(plan.deleteLocal), []);
});

test("lines", () => {
  assert.equal(deleteWindowText(1, "Squat · sæt 2"), "Slettet · Squat · sæt 2 · ");
  assert.equal(deleteWindowText(3, ""), "3 klip slettet · ");
  assert.equal(deleteUndoneLine(1, "Squat · sæt 2"), "Fortrudt · Squat · sæt 2 er tilbage.");
  assert.equal(deleteUndoneLine(3, ""), "Fortrudt · 3 klip er tilbage.");
  assert.equal(deleteDoneLine(1, "14 MB"), "Slettet · 14 MB frigjort.");
  assert.equal(deleteDoneLine(3, "42 MB"), "3 klip slettet · 42 MB frigjort.");
  assert.match(deleteFailedLine(1), /^Videoen er skjult, men ikke slettet endnu: serveren svarede ikke\. Appen prøver igen, når du åbner Optagelser\.$/);
  assert.match(deleteFailedLine(3), /^3 klip er skjult, men ikke slettet endnu/);
  const deadline = at(DELETE_UNDO_MS).toISOString();
  assert.equal(secondsLeft(deadline, T0.getTime()), 10);
  assert.equal(secondsLeft(deadline, at(9_001).getTime()), 1);
  assert.equal(secondsLeft(deadline, at(10_000).getTime()), 0);
});
