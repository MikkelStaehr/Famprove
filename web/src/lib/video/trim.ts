/**
 * Manual clipping (slice clip-trim, design/specs/clip-trim.md §2–§5; the user's decision 2026-10-20:
 * destructive). "Gem klip" writes the keyframe cut (cutClip, no re-encoding) as a new file beside the
 * original and points the index entry at it with a PendingTrim. All of it runs under the clip's
 * lock (ClipLock: navigator.locks, so other tabs too). Fortryd inside TRIM_UNDO_MS points
 * the entry back and deletes the cut; it writes nothing to the server. Once the deadline has passed
 * (a timer while open, or the next library / Fokus load: finishDueTrims) the finish runs:
 * (a) trimClip's one PATCH (the new duration_s; clip_in_s/clip_out_s and auto_* null), (b) delete the
 * original, (c) clear pendingTrim last. A step that fails leaves pendingTrim, so the next load retries;
 * a permanent refusal rolls back locally (the original is the clip again).
 *
 * Invariant (trimInvariant): the index always names exactly one file per clip and it exists; the
 * original is deleted only after the PATCH landed. Deps are injected so tests use the fakes.
 */
import type { SetClipAutoInput, SetClipAutoResult } from "./auto-clip.ts";
import { isClipId, storedDuration } from "./clips.ts";
import { cutClip } from "./cut.ts";
import { clipFile, type ClipIndex, type ClipIndexEntry } from "./index-store.ts";
import { clipFileName, cutFileName, type ClipFiles } from "./opfs.ts";

/** Fortryd's window (§3). */
export const TRIM_UNDO_MS = 10_000;

// --- server: trimClip's input and its rule ------------------------------------------------------

export type TrimClipInput = { readonly id: string; readonly durationS: unknown };

export function parseTrimClipInput(raw: unknown): TrimClipInput | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>; // narrowed field by field below
  if (!isClipId(r.id) || !("durationS" in r)) return null;
  return { id: r.id, durationS: r.durationS };
}

/**
 * The new duration, rounded to 0.1 s, when it may be stored over `currentS` (the row's duration_s,
 * read server-side; null = not read yet, shape only): > 0 and below the current, or equal to it
 * (idempotent: a retry after a lost reply). Null = refused.
 */
export function validateTrim(durationS: unknown, currentS: number | null): number | null {
  if (typeof durationS !== "number" || !Number.isFinite(durationS)) return null;
  const d = storedDuration(durationS);
  if (d === null) return null;
  if (currentS === null) return d;
  const cur = Math.round(currentS * 10) / 10;
  return d <= cur ? d : null;
}

/** trimClip's reply: the stored duration, or why nothing was written. */
export type TrimClipResult =
  | { readonly ok: true; readonly dev: boolean; readonly durationS: number }
  | { readonly ok: false; readonly reason: "invalid" | "duration" | "not_found" | "not_allowed" | "failed" };

// --- the phone: start, Fortryd, finish ------------------------------------------------------------

export type CutResult = { readonly blob: Blob; readonly actual: { readonly startS: number; readonly endS: number } };

/**
 * A per-clip lock (reviewer Must): startTrim, undoTrim, finishTrim and the stray sweep run under it,
 * so a Fortryd, a finish timer, another tab and the sweep never act on the same stale entry. `fn`
 * gets held = false only with ifAvailable when another holder has it (and then must do nothing).
 */
export type ClipLock = <T>(id: string, opts: { readonly ifAvailable?: boolean }, fn: (held: boolean) => Promise<T>) => Promise<T>;

export const LOCK_PREFIX = "famprove-clip-";

/** In-memory lock (tests, and the fallback where navigator.locks is missing): FIFO per id. */
export function memoryLock(): ClipLock {
  const tails = new Map<string, Promise<unknown>>();
  const count = new Map<string, number>();
  return <T>(id: string, opts: { readonly ifAvailable?: boolean }, fn: (held: boolean) => Promise<T>): Promise<T> => {
    if (opts.ifAvailable === true && (count.get(id) ?? 0) > 0) return fn(false);
    count.set(id, (count.get(id) ?? 0) + 1);
    const run = (tails.get(id) ?? Promise.resolve())
      .then(() => fn(true))
      .finally(() => {
        const n = (count.get(id) ?? 1) - 1;
        if (n === 0) {
          count.delete(id);
          tails.delete(id);
        } else count.set(id, n);
      });
    tails.set(
      id,
      run.catch(() => undefined),
    );
    return run;
  };
}

/** navigator.locks (covers other tabs), or null where the browser has none. */
export function browserLock(): ClipLock | null {
  const locks = typeof navigator === "undefined" ? undefined : (navigator as { locks?: LockManager }).locks; // absent in old browsers
  if (locks === undefined) return null;
  return <T>(id: string, opts: { readonly ifAvailable?: boolean }, fn: (held: boolean) => Promise<T>): Promise<T> =>
    locks.request(LOCK_PREFIX + id, { ifAvailable: opts.ifAvailable === true }, (lock) => fn(lock !== null)) as Promise<T>;
}

const fallbackLock = memoryLock();

function lockOf(deps: { readonly lock?: ClipLock }): ClipLock {
  return deps.lock ?? browserLock() ?? fallbackLock;
}

/** A stray file younger than this is never swept (a concurrent write may still be making it). */
export const STRAY_MIN_AGE_MS = 60_000;

export type TrimDeps = {
  readonly index: ClipIndex;
  readonly files: ClipFiles;
  /** The server action (trimClip); a thrown error (the network) counts as failed. */
  readonly trim: (input: { readonly id: string; readonly durationS: number }) => Promise<TrimClipResult>;
  /** cutClip by default; tests inject a fake. */
  readonly cut?: (file: Blob, inS: number, outS: number) => Promise<CutResult>;
  /** The per-clip lock; browserLock() (else an in-memory one) by default. */
  readonly lock?: ClipLock;
};

/** The cut's length as stored: the file's own range (end − start), 0.1 s, so it equals the file within 0.1 s. */
export function cutDuration(actual: CutResult["actual"]): number | null {
  const d = actual.endS - actual.startS;
  return Number.isFinite(d) ? storedDuration(d) : null;
}

/** The cut's file name: `<id>.cut.<ext>`, or `<id>.<ext>` when the clip already is a finished cut (a second cut). */
export function nextCutName(entry: Pick<ClipIndexEntry, "id" | "ext" | "fileName">): string {
  const cut = cutFileName(entry.id, entry.ext);
  return clipFile(entry) === cut ? clipFileName(entry.id, entry.ext) : cut;
}

export type StartTrimResult =
  | { readonly kind: "done"; readonly entry: ClipIndexEntry; readonly fromS: number | null; readonly toS: number; readonly deadline: string }
  /** §2.3 Failed: the original is untouched. `space`: the phone is out of space (adds "Telefonen mangler plads."). */
  | { readonly kind: "failed"; readonly space: boolean };

function outOfSpace(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

/**
 * Gem klip: cut [inS, outS] of the clip's file and make the cut the clip, with Fortryd until the
 * deadline. A cut already pending is finished first (a second cut ends the first's window). Order:
 * write the cut, read it back, then the index entry; a failure before the entry leaves the original
 * named (a stray cut file is swept by finishDueTrims).
 */
export function startTrim(deps: TrimDeps, id: string, inS: number, outS: number, now: Date): Promise<StartTrimResult> {
  return lockOf(deps)(id, {}, () => startTrimLocked(deps, id, inS, outS, now));
}

async function startTrimLocked(deps: TrimDeps, id: string, inS: number, outS: number, now: Date): Promise<StartTrimResult> {
  const cut = deps.cut ?? cutClip;
  try {
    let entry = await deps.index.get(id);
    if (entry?.pendingTrim !== undefined) {
      if ((await finishTrimLocked(deps, id, now, true)) !== "done") return { kind: "failed", space: false };
      entry = await deps.index.get(id);
    }
    if (entry === null || entry.state !== "done") return { kind: "failed", space: false };
    const source = await deps.files.readFile(clipFile(entry));
    if (source === null) return { kind: "failed", space: false };
    const out = await cut(source, inS, outS);
    const measured = cutDuration(out.actual);
    if (measured === null) return { kind: "failed", space: false };
    // a cut from the first keyframe to the end can measure 0.1 s over: never above the clip's own length
    const toS = entry.durationS === null ? measured : Math.min(measured, entry.durationS);
    const name = nextCutName(entry);
    await deps.files.writeFile(name, out.blob);
    const back = await deps.files.readFile(name);
    if (back === null || back.size !== out.blob.size) {
      await deps.files.removeFile(name);
      return { kind: "failed", space: false };
    }
    const deadline = new Date(now.getTime() + TRIM_UNDO_MS).toISOString();
    const next: ClipIndexEntry = {
      ...entry,
      fileName: name,
      durationS: toS,
      pendingTrim: { deadline, originalFileName: clipFile(entry), originalDurationS: entry.durationS, newDurationS: toS },
    };
    await deps.index.put(next);
    return { kind: "done", entry: next, fromS: entry.durationS, toS, deadline };
  } catch (error) {
    return { kind: "failed", space: outOfSpace(error) };
  }
}

export type UndoTrimResult =
  | { readonly kind: "undone"; readonly entry: ClipIndexEntry; readonly durationS: number | null }
  | { readonly kind: "expired" } // the window is over: the cut stays
  | { readonly kind: "none" } // nothing pending
  | { readonly kind: "failed" };

/**
 * Fortryd (§3): the original is the clip again (index first), then the cut file goes. No server call.
 * Under the clip's lock, reading the entry there: a finish that ran first leaves nothing pending, so
 * this is `expired` (the cut stays); `none` only when the clip has no entry.
 */
export function undoTrim(deps: Pick<TrimDeps, "index" | "files" | "lock">, id: string, now: Date): Promise<UndoTrimResult> {
  return lockOf(deps)(id, {}, () => undoTrimLocked(deps, id, now));
}

async function undoTrimLocked(deps: Pick<TrimDeps, "index" | "files">, id: string, now: Date): Promise<UndoTrimResult> {
  try {
    const entry = await deps.index.get(id);
    if (entry === null) return { kind: "none" };
    const p = entry.pendingTrim;
    if (p === undefined) return { kind: "expired" }; // a finish already ran (or a refusal rolled it back)
    if (now.getTime() >= Date.parse(p.deadline)) return { kind: "expired" };
    const cutName = clipFile(entry);
    const back: ClipIndexEntry = { ...withoutPending(entry), fileName: p.originalFileName, durationS: p.originalDurationS };
    await deps.index.put(back);
    if (cutName !== p.originalFileName) await deps.files.removeFile(cutName); // a failure leaves a stray, swept on the next load
    return { kind: "undone", entry: back, durationS: p.originalDurationS };
  } catch {
    return { kind: "failed" };
  }
}

function withoutPending(entry: ClipIndexEntry): ClipIndexEntry {
  const copy = { ...entry };
  delete (copy as { pendingTrim?: unknown }).pendingTrim; // the field is optional: absent = no cut pending
  return copy;
}

/**
 * done: committed (or nothing was pending); waiting: inside the window; failed: pendingTrim stays,
 * the next load retries (the network); refused: the server refused for good, or the cut file is
 * gone, so the original is the clip again locally (cut deleted, pendingTrim cleared).
 */
export type FinishTrimResult = "done" | "waiting" | "failed" | "refused";

/** trimClip's refusals that a retry never changes. */
const PERMANENT: ReadonlySet<string> = new Set(["duration", "invalid", "not_allowed"]);

/**
 * At 0 (§3): (a) the PATCH, (b) the original's delete, (c) pendingTrim cleared last. `not_found`
 * (the row isn't on the server yet, or is gone) has nothing to update: the entry's durationS is the
 * new one, so a later saveClip insert carries it. `force`: before the deadline (a second cut).
 * Under the clip's lock; the entry is read there, and the cut must exist before the original goes.
 */
export function finishTrim(deps: TrimDeps, id: string, now: Date, opts: { readonly force?: boolean } = {}): Promise<FinishTrimResult> {
  return lockOf(deps)(id, {}, () => finishTrimLocked(deps, id, now, opts.force === true));
}

async function finishTrimLocked(deps: TrimDeps, id: string, now: Date, force: boolean): Promise<FinishTrimResult> {
  try {
    const entry = await deps.index.get(id);
    const p = entry?.pendingTrim;
    if (entry === null || p === undefined) return "done";
    if (!force && now.getTime() < Date.parse(p.deadline)) return "waiting";
    const cutName = clipFile(entry);
    if (cutName !== p.originalFileName && (await deps.files.readFile(cutName)) === null) {
      if ((await deps.files.readFile(p.originalFileName)) === null) return "failed"; // neither file: nothing to save
      await rollBack(deps, entry, p);
      return "refused";
    }
    const r = await deps.trim({ id, durationS: p.newDurationS });
    if (!r.ok && PERMANENT.has(r.reason)) {
      await rollBack(deps, entry, p);
      return "refused";
    }
    if (!r.ok && r.reason !== "not_found") return "failed";
    if (p.originalFileName !== cutName) await deps.files.removeFile(p.originalFileName);
    await deps.index.put({ ...withoutPending(entry), durationS: p.newDurationS });
    return "done";
  } catch {
    return "failed";
  }
}

/** The original is the clip again (index first), then the cut goes. */
async function rollBack(deps: Pick<TrimDeps, "index" | "files">, entry: ClipIndexEntry, p: NonNullable<ClipIndexEntry["pendingTrim"]>): Promise<void> {
  const cutName = clipFile(entry);
  await deps.index.put({ ...withoutPending(entry), fileName: p.originalFileName, durationS: p.originalDurationS });
  if (cutName !== p.originalFileName) await deps.files.removeFile(cutName);
}

/** The files of `entries`' ids that no entry names (a cut whose entry was never written, a Fortryd's leftover cut). */
export function strayFiles(entries: readonly ClipIndexEntry[], names: readonly string[]): string[] {
  const own = new Map<string, Set<string>>();
  for (const e of entries) {
    const keep = new Set([clipFile(e)]);
    if (e.pendingTrim !== undefined) keep.add(e.pendingTrim.originalFileName);
    own.set(e.id, keep);
  }
  return names.filter((n) => {
    const id = fileClipId(n);
    const keep = id === null ? undefined : own.get(id);
    return keep !== undefined && !keep.has(n);
  });
}

/** The clip id of a file name (`<id>.<ext>` or `<id>.cut.<ext>`), or null. */
function fileClipId(name: string): string | null {
  const m = /^(.+?)(?:\.cut)?\.[a-z0-9]+$/.exec(name);
  return m === null ? null : m[1];
}

/**
 * Delete stray files of known clips: per clip under its lock with ifAvailable (a held lock, e.g. a
 * startTrim still writing its cut, skips the clip), the strays read again inside it, and never a
 * file younger than STRAY_MIN_AGE_MS (a File's lastModified; a Blob without one counts as old).
 */
export async function sweepStrays(deps: Pick<TrimDeps, "index" | "files" | "lock">, now: Date): Promise<string[]> {
  const lock = lockOf(deps);
  const removed: string[] = [];
  const ids = new Set<string>();
  for (const n of strayFiles(await deps.index.all(), await deps.files.names())) {
    const id = fileClipId(n);
    if (id !== null) ids.add(id);
  }
  for (const id of ids) {
    await lock(id, { ifAvailable: true }, async (held) => {
      if (!held) return;
      const e = await deps.index.get(id);
      if (e === null) return;
      for (const n of strayFiles([e], await deps.files.names())) {
        const f = await deps.files.readFile(n);
        if (f === null) continue;
        if (f instanceof File && now.getTime() - f.lastModified < STRAY_MIN_AGE_MS) continue;
        await deps.files.removeFile(n);
        removed.push(n);
      }
    });
  }
  return removed;
}

/**
 * The load's pass (Træning's library mount and Fokus's): finish every cut past its deadline, then
 * delete stray files of known clips. Returns the ids still pending (the caller times their finish).
 */
export async function finishDueTrims(
  deps: TrimDeps,
  now: Date,
): Promise<{ readonly finished: string[]; readonly failed: string[]; readonly refused: string[]; readonly pending: string[] }> {
  const finished: string[] = [];
  const failed: string[] = [];
  const refused: string[] = [];
  const pending: string[] = [];
  for (const e of await deps.index.all()) {
    if (e.pendingTrim === undefined) continue;
    const r = await finishTrim(deps, e.id, now);
    (r === "done" ? finished : r === "failed" ? failed : r === "refused" ? refused : pending).push(e.id);
  }
  try {
    await sweepStrays(deps, now);
  } catch {
    // a sweep that fails is the next load's
  }
  return { finished, failed, refused, pending };
}

/** A saveClip retry waits while a cut is pending (its finish comes first, so the insert carries the cut's length). */
export function syncAllowed(entry: Pick<ClipIndexEntry, "pendingTrim">): boolean {
  return entry.pendingTrim === undefined;
}

/** clip-trim §5: the parked automatic clip neither runs on nor writes setClipAuto for a clip with a pending cut (null: no entry, nothing pending). */
export function autoWriteAllowed(entry: Pick<ClipIndexEntry, "pendingTrim"> | null): boolean {
  return entry === null || entry.pendingTrim === undefined;
}

/** setClipAuto behind autoWriteAllowed: a clip with a pending cut sends nothing ("not_allowed"). */
export function guardAutoWrite(
  setClipAuto: (input: SetClipAutoInput) => Promise<SetClipAutoResult>,
  index: Pick<ClipIndex, "get">,
): (input: SetClipAutoInput) => Promise<SetClipAutoResult> {
  return async (input) => (autoWriteAllowed(await index.get(input.id)) ? setClipAuto(input) : { ok: false, reason: "not_allowed" });
}

/**
 * The invariant (pure): every done clip's index entry names a file that exists; a pending cut's
 * original exists too; no other file of the clip is left. Returns the violations (empty = holds).
 */
export function trimInvariant(entries: readonly ClipIndexEntry[], names: readonly string[]): string[] {
  const have = new Set(names);
  const out: string[] = [];
  for (const e of entries) {
    if (e.state !== "done") continue;
    if (!have.has(clipFile(e))) out.push(`${e.id}: the index names ${clipFile(e)}, which does not exist`);
    const p = e.pendingTrim;
    if (p !== undefined && !have.has(p.originalFileName)) out.push(`${e.id}: the original ${p.originalFileName} is gone while the cut is pending`);
  }
  for (const n of strayFiles(entries, names)) out.push(`${n}: a file no entry names`);
  return out;
}
