/**
 * What the 8-week cleanup deletes (slice video-library; user 2026-10-17): a clip older than
 * KEEP_DAYS days from recorded_at that is starred neither on the phone nor on the server. A
 * starred clip is never deleted. Age counts from the server's recorded_at when the row is known,
 * else the phone's. Pure: the caller deletes the file, the index entry and (deleteClip) the row.
 */
import { KEEP_DAYS, type VideoClipRow } from "./clips.ts";
import type { ClipIndexEntry } from "./index-store.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type CleanupPlan = {
  /** Local clips to delete: file, index entry, and the server row when there is one. */
  readonly deleteLocal: readonly ClipIndexEntry[];
  /** Server rows to delete with no local clip (already gone from the phone, and expired). */
  readonly deleteServerOnly: readonly string[];
  /** "fil mangler": server rows within the window (or starred) whose file is not on this phone. */
  readonly missingFile: readonly VideoClipRow[];
};

function expired(recordedAt: string, now: Date): boolean {
  const t = Date.parse(recordedAt);
  return !Number.isNaN(t) && now.getTime() - t > KEEP_DAYS * MS_PER_DAY; // an unreadable time is never expired
}

export function cleanupPlan(local: readonly ClipIndexEntry[], server: readonly VideoClipRow[], now: Date): CleanupPlan {
  const rows = new Map(server.map((r) => [r.id, r]));
  const localIds = new Set(local.map((e) => e.id));
  const deleteLocal = local.filter((e) => {
    const row = rows.get(e.id);
    if (e.starred || row?.starred === true || e.state === "recording") return false;
    return expired(row?.recordedAt ?? e.recordedAt, now);
  });
  const deleteServerOnly: string[] = [];
  const missingFile: VideoClipRow[] = [];
  for (const r of server) {
    if (localIds.has(r.id)) continue;
    if (!r.starred && expired(r.recordedAt, now)) deleteServerOnly.push(r.id);
    else missingFile.push(r);
  }
  return { deleteLocal, deleteServerOnly, missingFile };
}
