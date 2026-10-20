/**
 * Slet with Fortryd (slice clip-delete, design/specs/clip-delete.md; tech-lead's design). Slet marks
 * the index entry with a PendingDelete, so the clip leaves the list at once (libraryRows skips it).
 * Fortryd inside DELETE_UNDO_MS clears the batch's marks; it writes nothing to the server. Past the
 * deadline (a timer at the library, or the next load: finishDueDeletes) the finish runs, in order:
 * (a) the server's deleteClip (idempotent), (b) the clip's files (both while a cut is pending:
 * clipFiles), (c) the index entry last. A failed DELETE leaves the mark, file and entry, so the next
 * load retries. Every step runs under the clip's lock (trim.ts ClipLock), so a delete never races a cut.
 *
 * Invariant: a clip is listed exactly when it has no pending-delete mark, and its entry stays until
 * both its file and its row are gone. Deps are injected so tests use the fakes.
 */
import type { DeleteClipResult } from "./clips.ts";
import { clipFiles, type ClipIndex, type ClipIndexEntry } from "./index-store.ts";
import type { ClipFiles } from "./opfs.ts";
import { type ClipLock, lockOf } from "./trim.ts";

/** Fortryd's window (§1: 10 s). */
export const DELETE_UNDO_MS = 10_000;

export type DeleteDeps = {
  readonly index: ClipIndex;
  readonly files: ClipFiles;
  /** The server action (deleteClip); a thrown error (the network) counts as failed. Dev switches pass a fake that writes nothing. */
  readonly del: (input: { readonly id: string }) => Promise<DeleteClipResult>;
  readonly lock?: ClipLock;
};

function withoutDelete(entry: ClipIndexEntry): ClipIndexEntry {
  const copy = { ...entry };
  delete (copy as { pendingDelete?: unknown }).pendingDelete; // the field is optional: absent = listed
  return copy;
}

/** Slet (one clip, or Slet gemte's batch): mark each entry; returns the marked ones (an id without an entry is skipped). */
export async function startDelete(
  deps: Pick<DeleteDeps, "index" | "lock">,
  ids: readonly string[],
  batch: string,
  now: Date,
): Promise<{ readonly marked: ClipIndexEntry[]; readonly deadline: string }> {
  const deadline = new Date(now.getTime() + DELETE_UNDO_MS).toISOString();
  const marked: ClipIndexEntry[] = [];
  for (const id of ids) {
    const e = await lockOf(deps)(id, {}, async () => {
      const entry = await deps.index.get(id);
      if (entry === null || entry.state === "recording" || entry.pendingDelete !== undefined) return null;
      const next: ClipIndexEntry = { ...entry, pendingDelete: { deadline, batch } };
      await deps.index.put(next);
      return next;
    });
    if (e !== null) marked.push(e);
  }
  return { marked, deadline };
}

/** Fortryd: clears the batch's marks while its window is open; returns the restored entries (empty = expired or gone). */
export async function undoDelete(deps: Pick<DeleteDeps, "index" | "lock">, ids: readonly string[], batch: string, now: Date): Promise<ClipIndexEntry[]> {
  const restored: ClipIndexEntry[] = [];
  for (const id of ids) {
    const e = await lockOf(deps)(id, {}, async () => {
      const entry = await deps.index.get(id);
      const p = entry?.pendingDelete;
      if (entry === null || p === undefined || p.batch !== batch || now.getTime() >= Date.parse(p.deadline)) return null;
      const back = withoutDelete(entry);
      await deps.index.put(back);
      return back;
    });
    if (e !== null) restored.push(e);
  }
  return restored;
}

/** done: gone (or nothing was pending); waiting: inside the window; failed: the DELETE failed, everything stays for the next load. */
export type FinishDeleteResult = "done" | "waiting" | "failed";

/** At 0: (a) deleteClip, (b) the files, (c) the entry last. Under the clip's lock, reading the entry there. */
export function finishDelete(deps: DeleteDeps, id: string, now: Date): Promise<FinishDeleteResult> {
  return lockOf(deps)(id, {}, async () => {
    try {
      const entry = await deps.index.get(id);
      const p = entry?.pendingDelete;
      if (entry === null || p === undefined) return "done";
      if (now.getTime() < Date.parse(p.deadline)) return "waiting";
      let r: DeleteClipResult;
      try {
        r = await deps.del({ id });
      } catch {
        return "failed";
      }
      if (!r.ok && r.reason !== "invalid") return "failed"; // "invalid": an id the server can't hold, so no row to wait for
      for (const f of clipFiles(entry)) await deps.files.removeFile(f);
      await deps.index.remove(id);
      return "done";
    } catch {
      return "failed";
    }
  });
}

/** The load's pass: finish every delete past its deadline. `pending`: still in a window (the caller times their finish). */
export async function finishDueDeletes(
  deps: DeleteDeps,
  now: Date,
): Promise<{ readonly finished: string[]; readonly failed: string[]; readonly pending: ClipIndexEntry[] }> {
  const finished: string[] = [];
  const failed: string[] = [];
  const pending: ClipIndexEntry[] = [];
  for (const e of await deps.index.all()) {
    if (e.pendingDelete === undefined) continue;
    const r = await finishDelete(deps, e.id, now);
    if (r === "done") finished.push(e.id);
    else if (r === "failed") failed.push(e.id);
    else pending.push(e);
  }
  return { finished, failed, pending };
}

/** `gemt ✓`'s setter (Gem, Gem alle, a resolved share; the fixture uses it too). Under the lock, so a cut's put keeps it. */
export async function markSaved(deps: Pick<DeleteDeps, "index" | "lock">, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await lockOf(deps)(id, {}, async () => {
      const e = await deps.index.get(id);
      if (e !== null && e.savedOut !== true) await deps.index.put({ ...e, savedOut: true });
    });
  }
}

/** A share's outcome that sets `gemt ✓`: only "shared" (never cancelled, failed or unsupported). */
export function shareMarksSaved(outcome: "shared" | "unsupported" | "cancelled" | "failed"): boolean {
  return outcome === "shared";
}

/** Slet gemte's clips: `gemt ✓`, no ★, not pending, not recording. */
export function savedDeletable(entries: readonly ClipIndexEntry[]): ClipIndexEntry[] {
  return entries.filter((e) => e.savedOut === true && !e.starred && e.pendingDelete === undefined && e.state !== "recording");
}

/** The cleanup plans over these only: a pending delete is the delete path's (never deleted twice). */
export function notPendingDelete(entries: readonly ClipIndexEntry[]): ClipIndexEntry[] {
  return entries.filter((e) => e.pendingDelete === undefined);
}

/**
 * The invariant (pure): every listed entry (no pending-delete mark) has its files; no file of a known
 * clip id is left without its entry. A marked entry may have lost its files mid-finish: it is hidden
 * and stays until the row and files are gone.
 */
export function deleteInvariant(entries: readonly ClipIndexEntry[], names: readonly string[], knownIds: readonly string[]): string[] {
  const have = new Set(names);
  const out: string[] = [];
  const ids = new Set(entries.map((e) => e.id));
  for (const e of entries) {
    if (e.state !== "done" || e.pendingDelete !== undefined) continue;
    for (const f of clipFiles(e)) if (!have.has(f)) out.push(`${e.id}: the index names ${f}, which does not exist`);
  }
  for (const n of names) {
    const id = knownIds.find((k) => n.startsWith(`${k}.`));
    if (id !== undefined && !ids.has(id)) out.push(`${n}: a file without an entry`);
  }
  return out;
}

// --- lines (§3) -----------------------------------------------------------------------------------

export const DELETE_ANNOUNCE = "Slettet. Fortryd muligt i 10 sekunder.";
const RETRY = "serveren svarede ikke. Appen prøver igen, når du åbner Optagelser.";

/** The window's text before the Fortryd button: `Slettet · Squat · sæt 2 · ` / `3 klip slettet · `. */
export function deleteWindowText(count: number, label: string): string {
  return count === 1 ? `Slettet · ${label} · ` : `${count} klip slettet · `;
}

export function deleteUndoneLine(count: number, label: string): string {
  return count === 1 ? `Fortrudt · ${label} er tilbage.` : `Fortrudt · ${count} klip er tilbage.`;
}

/** At 0: the freed bytes as measured (null = not measured: the line without them). */
export function deleteDoneLine(count: number, freed: string | null): string {
  const head = count === 1 ? "Slettet" : `${count} klip slettet`;
  return freed === null ? `${head}.` : `${head} · ${freed} frigjort.`;
}

export function deleteFailedLine(count: number): string {
  return count === 1 ? `Videoen er skjult, men ikke slettet endnu: ${RETRY}` : `${count} klip er skjult, men ikke slettet endnu: ${RETRY}`;
}

/** Fortryd's countdown in whole seconds, 10 → 1 (0 once the window is over). */
export function secondsLeft(deadline: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
}
