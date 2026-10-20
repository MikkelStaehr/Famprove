/**
 * Manual clipping (slice clip-trim, design/specs/clip-trim.md §2–§5; the user's decision 2026-10-20:
 * destructive). "Gem klip" writes the keyframe cut (cutClip, no re-encoding) as a new file beside the
 * original and points the index entry at it with a PendingTrim. Fortryd inside TRIM_UNDO_MS points
 * the entry back and deletes the cut; it writes nothing to the server. Once the deadline has passed
 * (a timer while open, or the next library / Fokus load: finishDueTrims) the finish runs:
 * (a) trimClip's one PATCH (the new duration_s; clip_in_s/clip_out_s and auto_* null), (b) delete the
 * original, (c) clear pendingTrim last. A step that fails leaves pendingTrim, so the next load retries.
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

export type TrimDeps = {
  readonly index: ClipIndex;
  readonly files: ClipFiles;
  /** The server action (trimClip); a thrown error (the network) counts as failed. */
  readonly trim: (input: { readonly id: string; readonly durationS: number }) => Promise<TrimClipResult>;
  /** cutClip by default; tests inject a fake. */
  readonly cut?: (file: Blob, inS: number, outS: number) => Promise<CutResult>;
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
export async function startTrim(deps: TrimDeps, id: string, inS: number, outS: number, now: Date): Promise<StartTrimResult> {
  const cut = deps.cut ?? cutClip;
  try {
    let entry = await deps.index.get(id);
    if (entry?.pendingTrim !== undefined) {
      if ((await finishTrim(deps, id, now, { force: true })) !== "done") return { kind: "failed", space: false };
      entry = await deps.index.get(id);
    }
    if (entry === null || entry.state !== "done") return { kind: "failed", space: false };
    const source = await deps.files.readFile(clipFile(entry));
    if (source === null) return { kind: "failed", space: false };
    const out = await cut(source, inS, outS);
    const toS = cutDuration(out.actual);
    if (toS === null) return { kind: "failed", space: false };
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

/** Fortryd (§3): the original is the clip again (index first), then the cut file goes. No server call. */
export async function undoTrim(deps: Pick<TrimDeps, "index" | "files">, id: string, now: Date): Promise<UndoTrimResult> {
  try {
    const entry = await deps.index.get(id);
    const p = entry?.pendingTrim;
    if (entry === null || p === undefined) return { kind: "none" };
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

/** done: committed (or nothing was pending); waiting: inside the window; failed: pendingTrim stays, the next load retries. */
export type FinishTrimResult = "done" | "waiting" | "failed";

/**
 * At 0 (§3): (a) the PATCH, (b) the original's delete, (c) pendingTrim cleared last. `not_found`
 * (the row isn't on the server yet, or is gone) has nothing to update: the entry's durationS is the
 * new one, so a later saveClip insert carries it. `force`: before the deadline (a second cut).
 */
export async function finishTrim(deps: TrimDeps, id: string, now: Date, opts: { readonly force?: boolean } = {}): Promise<FinishTrimResult> {
  try {
    const entry = await deps.index.get(id);
    const p = entry?.pendingTrim;
    if (entry === null || p === undefined) return "done";
    if (opts.force !== true && now.getTime() < Date.parse(p.deadline)) return "waiting";
    const r = await deps.trim({ id, durationS: p.newDurationS });
    if (!r.ok && r.reason !== "not_found") return "failed";
    if (p.originalFileName !== clipFile(entry)) await deps.files.removeFile(p.originalFileName);
    await deps.index.put({ ...withoutPending(entry), durationS: p.newDurationS });
    return "done";
  } catch {
    return "failed";
  }
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
    const m = /^(.+?)(?:\.cut)?\.[a-z0-9]+$/.exec(n);
    const keep = m === null ? undefined : own.get(m[1]);
    return keep !== undefined && !keep.has(n);
  });
}

/**
 * The load's pass (Træning's library mount and Fokus's): finish every cut past its deadline, then
 * delete stray files of known clips. Returns the ids still pending (the caller times their finish).
 */
export async function finishDueTrims(deps: TrimDeps, now: Date): Promise<{ readonly finished: string[]; readonly failed: string[]; readonly pending: string[] }> {
  const finished: string[] = [];
  const failed: string[] = [];
  const pending: string[] = [];
  for (const e of await deps.index.all()) {
    if (e.pendingTrim === undefined) continue;
    const r = await finishTrim(deps, e.id, now);
    (r === "done" ? finished : r === "failed" ? failed : pending).push(e.id);
  }
  try {
    for (const n of strayFiles(await deps.index.all(), await deps.files.names())) await deps.files.removeFile(n);
  } catch {
    // a sweep that fails is the next load's
  }
  return { finished, failed, pending };
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
