/**
 * The phone's local index of its clips (slice video-record): one entry per clip, kept in IndexedDB
 * by the browser adapter (index-store-browser.ts) and in memory by the fake for tests. The index,
 * not the server, knows which files exist; public.video_clips only mirrors the metadata.
 */
import type { IsoDate } from "../db/rows.ts";
import type { ClipExt } from "./mime.ts";
import { clipFileName } from "./opfs.ts";

/** recording: the recorder is running; done: stopped and closed; afbrudt: the page died mid-recording. */
export type ClipState = "recording" | "done" | "afbrudt";

export type ClipSetKey = {
  readonly date: IsoDate;
  readonly sessionNo: number;
  readonly row: number;
  readonly set: number; // ≥ 1, working sets only
};

/** The name stack at Optag (video-library §5): the exercise and the variant's display name (null: none). */
export type ClipNameStack = { readonly exercise: string; readonly variant: string | null };

export type ClipIndexEntry = {
  readonly id: string; // the uuid, also public.video_clips.id
  readonly setKey: ClipSetKey;
  readonly ext: ClipExt;
  readonly recordedAt: string; // ISO timestamp, the phone's clock at Optag
  readonly durationS: number | null; // null while recording
  readonly starred: boolean;
  readonly starSynced: boolean; // false until starClip confirmed the row's starred
  readonly state: ClipState;
  /** false: the row's insert failed, retried on the next open (video-record §8); absent = synced (older entries). */
  readonly synced?: boolean;
  /** Set when saveClip refused the row for good (PERMANENT_SAVE_REFUSALS): never retried; absent = retry. */
  readonly syncRefused?: string;
  /** The names at Optag, so a clip with no server row (afbrudt) still shows them; absent on older entries. */
  readonly names?: ClipNameStack;
  /** The clip's file in CLIPS_DIR (slice clip-trim); absent on older entries = `<id>.<ext>`. Read it through clipFile(entry). */
  readonly fileName?: string;
  /** A manual cut inside Fortryd's window (slice clip-trim): fileName is the cut, the original still exists. */
  readonly pendingTrim?: PendingTrim;
};

/**
 * Fortryd's window (slice clip-trim): until `deadline` the original stays; after it finishTrim sends
 * the new duration, deletes the original and clears this last. Absent = no cut pending.
 */
export type PendingTrim = {
  readonly deadline: string; // ISO timestamp, the phone's clock at the cut + TRIM_UNDO_MS
  readonly originalFileName: string;
  readonly originalDurationS: number | null; // what Fortryd gives back
  readonly newDurationS: number; // the cut file's own length (cutClip's actual range), 0.1 s
};

/** The one path builder for a clip's file (slice clip-trim): the entry's fileName, else the old `<id>.<ext>`. */
export function clipFile(entry: Pick<ClipIndexEntry, "id" | "ext" | "fileName">): string {
  return entry.fileName ?? clipFileName(entry.id, entry.ext);
}

/** Every file a clip owns on the phone: its file, plus the original while a cut is pending (deleting a clip deletes both). */
export function clipFiles(entry: Pick<ClipIndexEntry, "id" | "ext" | "fileName" | "pendingTrim">): string[] {
  const own = clipFile(entry);
  const original = entry.pendingTrim?.originalFileName;
  return original === undefined || original === own ? [own] : [own, original];
}

export interface ClipIndex {
  all(): Promise<ClipIndexEntry[]>;
  get(id: string): Promise<ClipIndexEntry | null>;
  put(entry: ClipIndexEntry): Promise<void>; // insert or replace by id
  remove(id: string): Promise<void>; // idempotent
}

/** In-memory index for tests (and a fallback where IndexedDB is missing). */
export function memoryClipIndex(initial: readonly ClipIndexEntry[] = []): ClipIndex {
  const entries = new Map(initial.map((e) => [e.id, e]));
  return {
    all: async () => [...entries.values()],
    get: async (id) => entries.get(id) ?? null,
    put: async (entry) => {
      entries.set(entry.id, entry);
    },
    remove: async (id) => {
      entries.delete(id);
    },
  };
}

/** Entries left "recording" when the app starts again: the page died, so they are afbrudt. */
export function interrupted(entries: readonly ClipIndexEntry[], currentId: string | null): ClipIndexEntry[] {
  return entries.filter((e) => e.state === "recording" && e.id !== currentId).map((e) => ({ ...e, state: "afbrudt" }));
}
