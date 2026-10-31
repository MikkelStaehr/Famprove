import assert from "node:assert/strict";
import { test } from "node:test";

import { approvableClips, approveAll, type ApproveDeps, finishBatch, pendingTrimBatches, undoBatch } from "../src/lib/video/approve-all.ts";
import {
  APPROVE_IDLE,
  approveAllFailedLine,
  approveBusyLabel,
  approveCount,
  approveDoneAnnouncement,
  approveLabel,
  approveLineText,
  approveResultState,
  type ApproveState,
  approveStartAnnouncement,
  busyAfter,
} from "../src/lib/video/approve-line.ts";
import { lineParts, type LineInput } from "../src/lib/video/clip-line.ts";
import { batchTimers } from "../src/lib/video/delete.ts";
import { memoryClipIndex } from "../src/lib/video/index-store.ts";
import { clipsFixtureWithApprove } from "../src/lib/video/library-fixture.ts";
import { memoryClipFiles } from "../src/lib/video/opfs.ts";
import { secondsLeft } from "../src/lib/video/trim-flow.ts";
import { type CutResult, memoryLock, TRIM_UNDO_MS } from "../src/lib/video/trim.ts";

const TODAY = "2026-10-19";
const BASE: LineInput = { loading: false, error: false, clips: 11, save: 6, deletable: 2, pending: false, sheetOpen: false };

test("the button: first in row 2 only when N > 0; hidden with the switch off or N = 0", () => {
  assert.deepEqual(lineParts({ ...BASE, approve: approveCount(true, 2, APPROVE_IDLE) }).row2, ["approve", "save", "delete"]);
  assert.equal(approveLabel(2), "Godkend auto-klip · 2");
  assert.deepEqual(lineParts({ ...BASE, approve: approveCount(true, 0, APPROVE_IDLE) }).row2, ["save", "delete"]);
  assert.deepEqual(lineParts({ ...BASE, approve: approveCount(false, 2, APPROVE_IDLE) }).row2, ["save", "delete"], "switch off: no auto range is trusted");
  assert.deepEqual(lineParts({ ...BASE, save: 0, deletable: 0, approve: 0 }).row2, [], "all three hidden: row 2 goes");
  assert.deepEqual(lineParts({ ...BASE, save: 0, deletable: 0, approve: 3 }).row2, ["approve"]);
});

test("busy: Klipper 1 af N at the tap, steps per clip, the button stays while its batch runs", () => {
  const steps: ApproveState[] = [busyAfter(0, 0, 3), busyAfter(1, 0, 3), busyAfter(1, 1, 3), busyAfter(3, 0, 3)];
  assert.deepEqual(steps.map((s) => (s.kind === "busy" ? approveBusyLabel(s.k, s.total) : "")), ["Klipper 1 af 3 …", "Klipper 2 af 3 …", "Klipper 3 af 3 …", "Klipper 3 af 3 …"]);
  assert.equal(approveCount(true, 0, busyAfter(1, 0, 3)), 3, "N drops as clips are cut; the button keeps its place");
  assert.equal(approveCount(false, 0, busyAfter(1, 0, 3)), 3);
  assert.equal(approveStartAnnouncement(3), "Klipper 3 klip.");
  assert.equal(approveLineText(busyAfter(0, 0, 3)), null, "no status line while cutting");
});

test("done: N klip klippet · Fortryd with a 10 s text countdown; a partial failure names both counts; all failed", () => {
  const deadline = "2026-10-19T10:00:10.000Z";
  const done = approveResultState({ batch: "b", done: ["a", "b", "c"], failed: [], deadline });
  assert.equal(approveLineText(done), "3 klip klippet · ");
  assert.equal(approveDoneAnnouncement(3), "3 klip klippet. Fortryd muligt i 10 sekunder.");
  const t0 = Date.parse(deadline) - TRIM_UNDO_MS;
  assert.equal(secondsLeft(deadline, t0), 10);
  assert.equal(secondsLeft(deadline, t0 + 1500), 9);
  assert.equal(secondsLeft(deadline, t0 + 9_200), 1);
  const partial = approveResultState({ batch: "b", done: ["a", "b"], failed: [{ id: "c", space: false }], deadline });
  assert.equal(approveLineText(partial), "2 klip klippet, 1 kunne ikke klippes · ");
  const none = approveResultState({ batch: "b", done: [], failed: [{ id: "a" }, { id: "b" }, { id: "c" }], deadline: null });
  assert.deepEqual(none, { kind: "allFailed", total: 3 });
  assert.equal(approveLineText(none), "Kunne ikke klippe de 3 klip. Videoerne er urørte.");
  assert.equal(approveAllFailedLine(3), approveLineText(none));
  assert.equal(approveLineText({ kind: "finished", count: 3, freed: 42_000_000 }), "3 klip klippet · 42 MB frigjort.");
  assert.equal(approveLineText({ kind: "finished", count: 3, freed: null }), "3 klip klippet.");
  assert.equal(approveLineText({ kind: "undone", count: 3 }), "Fortrudt · 3 klip er hele igen.");
});

// --- the dev fixture, through the real approvableClips, cut by fakes (nothing written) ----------------

/** A fake cut like the fixture's: the keyframe 0.5 s before in. */
async function fakeCut(_file: Blob, inS: number, outS: number): Promise<CutResult> {
  return { blob: new Blob([new Uint8Array(16)]), actual: { startS: Math.max(0, Math.round((inS - 0.5) * 10) / 10), endS: outS } };
}

async function fixtureWorld() {
  const f = clipsFixtureWithApprove(TODAY);
  const files = memoryClipFiles();
  for (const e of f.local) await files.writeFile(`${e.id}.${e.ext}`, new Blob([new Uint8Array(32)]));
  const writes: string[] = [];
  const deps: ApproveDeps = {
    index: memoryClipIndex(f.local),
    files,
    trim: async (i) => {
      writes.push(i.id);
      return { ok: true, dev: true, durationS: i.durationS };
    },
    cut: fakeCut,
    lock: memoryLock(),
    newBatch: () => "fixture-batch",
  };
  return { f, deps, writes };
}

test("the clips fixture: 2 exact clips approvable; the off-by-one, Klip selv, own range and older clips are not; the switch off hides them", async () => {
  const { f, deps } = await fixtureWorld();
  const got = approvableClips(f.rows, await deps.index.all(), f.autoLast, TODAY);
  assert.equal(got.length, 2);
  const byId = new Map(f.rows.map((r) => [r.id, r]));
  for (const c of got) assert.deepEqual([c.inS, c.outS], [byId.get(c.id)?.autoInS, byId.get(c.id)?.autoOutS], "cut to the automatic in/out");
  const offByOne = f.rows.find((r) => r.autoStatus === "clipped" && r.date === TODAY && !got.some((c) => c.id === r.id) && f.autoLast[r.id] !== undefined);
  assert.ok(offByOne !== undefined, "the fixture holds a clipped clip off by one");
  assert.ok(f.rows.some((r) => r.date === TODAY && r.autoStatus === "low_confidence"), "and a Klip selv clip");
  assert.equal(approveCount(false, got.length, APPROVE_IDLE), 0);
});

test("the batch timer (delete.ts's batchTimers, one per batch) finishes every clip at the deadline; Fortryd before it writes nothing", async () => {
  const { f, deps, writes } = await fixtureWorld();
  const clips = approvableClips(f.rows, await deps.index.all(), f.autoLast, TODAY);
  let ms = Date.parse(`${TODAY}T10:00:00.000Z`);
  const r = await approveAll(deps, clips, () => new Date((ms += 1000)));
  assert.equal(r.done.length, 2);
  assert.equal(writes.length, 0, "no write inside the window");
  const [batch] = pendingTrimBatches(await deps.index.all());
  assert.deepEqual({ ...batch, ids: batch?.ids.toSorted() }, { batch: "fixture-batch", ids: r.done.toSorted(), deadline: r.deadline });

  // one fake clock, one timer for the batch
  const due = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  const finished: { p: ReturnType<typeof finishBatch> | null } = { p: null };
  const timers = batchTimers(
    {
      setTimeout: (fn, wait) => {
        const h = next++;
        due.set(h, { at: ms + wait, fn });
        return h;
      },
      clearTimeout: (h) => void due.delete(h as number),
    },
    (_b, ids) => {
      finished.p = finishBatch(deps, ids, new Date(r.deadline!));
    },
  );
  timers.schedule(batch!.batch, batch!.ids, batch!.deadline, ms);
  assert.equal(due.size, 1, "one timer per batch");
  for (const [h, t] of [...due]) {
    if (t.at > Date.parse(r.deadline!) + 50) continue;
    due.delete(h);
    t.fn();
  }
  const res = await finished.p;
  assert.ok(res !== null, "the timer fired");
  assert.deepEqual(Object.values(res ?? {}), ["done", "done"]);
  assert.deepEqual(writes.toSorted(), [...r.done].toSorted(), "exactly one write per cut clip, at 0");
  assert.deepEqual(pendingTrimBatches(await deps.index.all()), []);
});

test("Fortryd inside the window restores every clip of the batch and writes nothing", async () => {
  const { f, deps, writes } = await fixtureWorld();
  const clips = approvableClips(f.rows, await deps.index.all(), f.autoLast, TODAY);
  const t = Date.parse(`${TODAY}T10:00:00.000Z`);
  const r = await approveAll(deps, clips, () => new Date(t));
  const u = await undoBatch(deps, r.batch, new Date(t + 3000));
  assert.equal(u.kind, "undone");
  if (u.kind === "undone") assert.deepEqual(u.restored.toSorted(), [...r.done].toSorted());
  assert.equal(writes.length, 0);
  assert.equal(approvableClips(f.rows, await deps.index.all(), f.autoLast, TODAY).length, 2, "the button comes back with the same N");
});
