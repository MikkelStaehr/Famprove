/**
 * Godkend alle (slice clip-approve-all, user 2026-10-31): one tap cuts every high-confidence
 * automatic clip of today destructively, with one Fortryd for TRIM_UNDO_MS. Each clip is cut by
 * trim.ts's startTrim (kind "approved", under the clip's own lock); the batch only adds a batch id
 * and one shared deadline to the clips' PendingTrim. Every clip's finish is trim.ts's finishTrim, on
 * its own (a timer per batch through finishBatch, or finishDueTrims on the next load), so one clip
 * never waits on, or fails with, another. Deps are injected so tests use the fakes.
 */
import type { IsoDate } from "../db/rows.ts";
import type { AutoLast } from "./auto-last.ts";
import type { VideoClipRow } from "./clips.ts";
import { type ClipIndexEntry, isCut } from "./index-store.ts";
import { type FinishTrimResult, finishTrim, lockOf, startTrim, type TrimDeps, undoTrim } from "./trim.ts";

/** A clip Godkend alle may cut: its automatic range on the original file. */
export type ApprovableClip = {
  readonly id: string;
  readonly inS: number;
  readonly outS: number;
  readonly recordedAt: string; // the server row's, for the order (newest first)
};

/** The reps the phone's last run found in the polarity it chose; null = not known. */
function foundReps(last: AutoLast): number | null {
  const s = last.summary;
  if (s === undefined) return null;
  return s.chosen === 1 ? s.peaksUp : s.chosen === -1 ? s.peaksDown : null;
}

/**
 * High confidence (the user's choice, 2026-10-31): the reps found equal the expected reps exactly;
 * the server's `clipped` alone allows one off. The rep count lives only in this phone's last local
 * outcome (auto-last.ts, never sent), so a clip without a summary (analysed on another phone, a run
 * before slice clip-summary, or storage cleared) can't show the exact count and is not approvable:
 * it is left for the user to check, never guessed.
 */
function exactCount(last: AutoLast | undefined): boolean {
  if (last === undefined || last.kind !== "clipped") return false;
  const found = foundReps(last);
  const expected = last.summary?.expected ?? null;
  return found !== null && expected !== null && found === expected;
}

/** The local file is the untouched original and nothing else is happening to it. */
function localOriginal(entry: ClipIndexEntry | undefined): boolean {
  return entry !== undefined && entry.state === "done" && !isCut(entry) && entry.pendingTrim === undefined && entry.pendingDelete === undefined;
}

/**
 * The clips of `today` Godkend alle cuts, newest first (pure): the server's auto_status `clipped`
 * with both automatic points (in < out); no own range (clip_in_s/clip_out_s null, so Klip selv and
 * Ret klip are never overwritten); a local file that is the original (done: not recording, not
 * afbrudt; not cut; no pending cut or delete); and this phone's last outcome `clipped` with the
 * exact rep count. low_confidence and failed (Klip selv) never qualify.
 */
export function approvableClips(
  rows: readonly VideoClipRow[],
  localEntries: readonly ClipIndexEntry[],
  autoLast: Readonly<Record<string, AutoLast>>,
  today: IsoDate,
): ApprovableClip[] {
  const local = new Map(localEntries.map((e) => [e.id, e]));
  const out: ApprovableClip[] = [];
  for (const r of rows) {
    if (r.date !== today || r.autoStatus !== "clipped" || r.autoInS === null || r.autoOutS === null || !(r.autoInS < r.autoOutS)) continue;
    if (r.clipInS !== null || r.clipOutS !== null) continue;
    const entry = local.get(r.id);
    if (!localOriginal(entry) || entry?.setKey.date !== today) continue;
    if (!exactCount(autoLast[r.id])) continue;
    out.push({ id: r.id, inS: r.autoInS, outS: r.autoOutS, recordedAt: r.recordedAt });
  }
  return out.toSorted((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || (a.id < b.id ? -1 : 1));
}

export type ApproveDeps = TrimDeps & {
  /** The batch id; crypto.randomUUID() by default. */
  readonly newBatch?: () => string;
};

export type ApproveProgress = { readonly done: number; readonly failed: number; readonly total: number };

export type ApproveAllResult = {
  readonly batch: string;
  readonly done: readonly string[];
  /**
   * space: the phone was out of space for that clip ("Telefonen mangler plads."). notOriginal: the clip
   * was no longer the untouched original under its lock (a Gem klip in the player got there first):
   * skipped, and the user's own cut and its Fortryd are left as they are.
   */
  readonly failed: readonly { readonly id: string; readonly space: boolean; readonly notOriginal?: true }[];
  /** The batch's one deadline (Fortryd's countdown); null when nothing was cut. */
  readonly deadline: string | null;
};

/**
 * Cut each clip in turn with its automatic range (kind "approved", the batch id on its PendingTrim).
 * A clip that fails leaves its original untouched and the batch goes on. `now` is a clock: each cut
 * gets its own time, so each deadline starts after its own cut.
 *
 * Alignment: once all are cut, every clip of the batch still pending gets the latest of the batch's
 * deadlines (the last cut's), under its own lock, so one countdown fits all and a deadline only
 * ever moves later. A page that dies before it leaves each clip its own deadline; each still
 * finishes (finishDueTrims) or undoes (undoBatch, per clip) on its own, so nothing is lost.
 * The UI shows Fortryd only once this resolves.
 */
export async function approveAll(
  deps: ApproveDeps,
  clips: readonly ApprovableClip[],
  now: () => Date,
  onProgress?: (p: ApproveProgress) => void,
): Promise<ApproveAllResult> {
  const batch = deps.newBatch?.() ?? crypto.randomUUID();
  const done: string[] = [];
  const failed: { id: string; space: boolean; notOriginal?: true }[] = [];
  let latest: string | null = null;
  for (const c of clips) {
    let r: Awaited<ReturnType<typeof startTrim>>;
    try {
      r = await startTrim(deps, c.id, c.inS, c.outS, now(), "approved", { batch, onlyOriginal: true });
    } catch {
      r = { kind: "failed", space: false }; // startTrim catches its own; a lock that throws is one clip's failure too
    }
    if (r.kind === "done") {
      done.push(c.id);
      if (latest === null || Date.parse(r.deadline) > Date.parse(latest)) latest = r.deadline;
    } else failed.push(r.reason === "not_original" ? { id: c.id, space: r.space, notOriginal: true } : { id: c.id, space: r.space });
    onProgress?.({ done: done.length, failed: failed.length, total: clips.length });
  }
  if (latest !== null) await alignDeadlines(deps, done, batch, latest);
  return { batch, done, failed, deadline: latest };
}

/** Every clip still pending in `batch` gets `deadline` when it is later than its own (never earlier). A failure leaves that clip's own. */
async function alignDeadlines(deps: Pick<TrimDeps, "index" | "lock">, ids: readonly string[], batch: string, deadline: string): Promise<void> {
  for (const id of ids) {
    try {
      await lockOf(deps)(id, {}, async () => {
        const e = await deps.index.get(id);
        const p = e?.pendingTrim;
        if (e === null || p === undefined || p.batch !== batch || Date.parse(p.deadline) >= Date.parse(deadline)) return;
        await deps.index.put({ ...e, pendingTrim: { ...p, deadline } });
      });
    } catch {
      // its own deadline stands; it finishes or undoes alone
    }
  }
}

export type UndoBatchResult =
  | { readonly kind: "undone"; readonly restored: readonly string[]; readonly expired: readonly string[]; readonly failed: readonly string[] }
  /** Nothing of the batch was pending inside its window (finished, or the window is over): the cuts stay. */
  | { readonly kind: "expired" };

/**
 * Fortryd: undoTrim for every clip of the batch still pending, each under its own lock, read there
 * (applied only while it is still this batch's pending cut inside its window, else `expired`).
 * No server call. A clip that fails to restore stays cut and is reported.
 */
export async function undoBatch(deps: Pick<TrimDeps, "index" | "files" | "lock">, batch: string, now: Date): Promise<UndoBatchResult> {
  const ids = (await deps.index.all()).filter((e) => e.pendingTrim?.batch === batch).map((e) => e.id);
  const restored: string[] = [];
  const expired: string[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    const r = await undoTrim(deps, id, now, { batch });
    (r.kind === "undone" ? restored : r.kind === "failed" ? failed : expired).push(id);
  }
  return restored.length === 0 && failed.length === 0 ? { kind: "expired" } : { kind: "undone", restored, expired, failed };
}

/**
 * The batch's finish at its deadline (the library's one timer per batch): finishTrim for each clip
 * at once, each under its own lock, so one never waits on another; a failed one stays pending and
 * finishDueTrims retries it on the next load.
 */
export async function finishBatch(deps: TrimDeps, ids: readonly string[], now: Date): Promise<Readonly<Record<string, FinishTrimResult>>> {
  const results = await Promise.all(ids.map((id) => finishTrim(deps, id, now).catch((): FinishTrimResult => "failed")));
  return Object.fromEntries(ids.map((id, i) => [id, results[i]]));
}

/**
 * One batch at a time (review): the batch's id is set synchronously at the tap, before any await, so a
 * double tap can't start a second batch (React state would only show it after a render). `current`
 * is the running batch, so a page coming back mid-batch leaves its timer alone (rearmableBatches).
 */
export function batchGuard(): {
  readonly current: () => string | null;
  readonly run: <T>(batch: string, fn: () => Promise<T>) => Promise<T | null>;
} {
  let current: string | null = null;
  return {
    current: () => current,
    async run<T>(batch: string, fn: () => Promise<T>): Promise<T | null> {
      if (current !== null) return null;
      current = batch;
      try {
        return await fn();
      } finally {
        current = null;
      }
    },
  };
}

/**
 * The batches whose one timer a re-arm (page visible again, a reload) sets: every pending batch but
 * the one still being cut (`running`), whose clips cut so far must not finish before its Fortryd shows;
 * approveAll aligns its deadline at its end and the library times it then.
 */
export function rearmableBatches(entries: readonly ClipIndexEntry[], running: string | null): TrimBatch[] {
  return pendingTrimBatches(entries).filter((b) => b.batch !== running);
}

/** One batch's pending cuts (a reload re-arms one timer and one Fortryd per batch); the deadline is the latest. */
export type TrimBatch = { readonly batch: string; readonly ids: readonly string[]; readonly deadline: string };

/** The pending cuts grouped by batch, in the entries' order (a cut without a batch is a single Gem klip: not listed). */
export function pendingTrimBatches(entries: readonly ClipIndexEntry[]): TrimBatch[] {
  const by = new Map<string, { ids: string[]; deadline: string }>();
  for (const e of entries) {
    const p = e.pendingTrim;
    if (p?.batch === undefined) continue;
    const b = by.get(p.batch);
    if (b === undefined) by.set(p.batch, { ids: [e.id], deadline: p.deadline });
    else {
      b.ids.push(e.id);
      if (Date.parse(p.deadline) > Date.parse(b.deadline)) b.deadline = p.deadline;
    }
  }
  return [...by].map(([batch, b]) => ({ batch, ids: b.ids, deadline: b.deadline }));
}
