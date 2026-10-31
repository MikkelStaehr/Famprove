/**
 * The keep time and the 24 h rule (slice clip-retention, design/specs/clip-retention.md; user
 * 2026-10-31). An unstarred clip is deleted when it is older than the keep time (1 / 2 / 4 / 8
 * weeks, from recorded_at), or 24 h after it first got `gemt ✓` (savedAt). ★ (phone or server), a
 * pending trim, a pending delete and a clip being recorded are never deleted. The server's 56-day
 * rule (KEEP_DAYS) stays the maximum. The choice is local (localStorage), read through
 * useSyncExternalStore like auto-switch.ts; storage is injected, so node tests it.
 */
import { KEEP_DAYS, type VideoClipRow } from "./clips.ts";
import { DELETE_UNDO_MS, type DeleteDeps, finishDelete, startDelete } from "./delete.ts";
import type { ClipIndexEntry } from "./index-store.ts";

export const KEEP_WEEKS_KEY = "famprove.clips.keepWeeks";
/** "declined": Ikke nu (the 8-week rule keeps running, never asked again on open). */
export const RETENTION_ASK_KEY = "famprove.clips.retentionAsk";
/** The last cleanup's time (ms since epoch): it runs at most once an hour. */
export const RETENTION_RUN_KEY = "famprove.clips.retentionRun";

export const KEEP_CHOICES = [1, 2, 4, 8] as const;
export type KeepWeeks = (typeof KEEP_CHOICES)[number];
export const DEFAULT_KEEP_WEEKS: KeepWeeks = 2;
export const SAVED_KEEP_MS = 24 * 60 * 60 * 1000;
export const RUN_EVERY_MS = 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** on: the rules are on with this keep time; unasked: no answer yet; declined: Ikke nu. Both of the latter run the 8-week rule. */
export type Retention = { readonly kind: "on"; readonly weeks: KeepWeeks } | { readonly kind: "unasked" } | { readonly kind: "declined" };

const UNASKED: Retention = { kind: "unasked" };
const DECLINED: Retention = { kind: "declined" };
const ON: Readonly<Record<KeepWeeks, Retention>> = { 1: { kind: "on", weeks: 1 }, 2: { kind: "on", weeks: 2 }, 4: { kind: "on", weeks: 4 }, 8: { kind: "on", weeks: 8 } };

function parseWeeks(raw: string | null): KeepWeeks | null {
  const n = raw === null ? NaN : Number(raw);
  return (KEEP_CHOICES as readonly number[]).includes(n) ? (n as KeepWeeks) : null;
}

/** A pure read (useSyncExternalStore's getSnapshot; the objects are constants, so the snapshot is stable). */
export function readRetention(store: Pick<Storage, "getItem"> | null): Retention {
  if (store === null) return UNASKED;
  try {
    const w = parseWeeks(store.getItem(KEEP_WEEKS_KEY));
    if (w !== null) return ON[w];
    return store.getItem(RETENTION_ASK_KEY) === "declined" ? DECLINED : UNASKED;
  } catch {
    return UNASKED;
  }
}

const listeners = new Set<() => void>();

/** Stores the keep time (switches the rules on); a blocked storage is ignored. */
export function setKeepWeeks(store: Pick<Storage, "setItem"> | null, weeks: KeepWeeks): void {
  try {
    store?.setItem(KEEP_WEEKS_KEY, String(weeks));
  } catch {
    // ignored: the choice then reads as before
  }
  for (const l of listeners) l();
}

/** Ikke nu: never asked again on open. */
export function declineRetention(store: Pick<Storage, "setItem"> | null): void {
  try {
    store?.setItem(RETENTION_ASK_KEY, "declined");
  } catch {
    // ignored
  }
  for (const l of listeners) l();
}

export function subscribeRetention(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The keep time the cleanup applies: the choice, else the 8-week rule (KEEP_DAYS). */
export function keepDays(r: Retention): number {
  return r.kind === "on" ? Math.min(r.weeks * 7, KEEP_DAYS) : KEEP_DAYS;
}

/** At most once an hour (a missing or unreadable time is due). */
export function retentionRunDue(lastRunMs: string | null, nowMs: number): boolean {
  const t = lastRunMs === null ? NaN : Number(lastRunMs);
  return !Number.isFinite(t) || nowMs - t >= RUN_EVERY_MS || t > nowMs;
}

/** The throttle's stored time; a blocked storage reads as null (due), so it runs once per open, never in a loop. */
export function readLastRun(store: Pick<Storage, "getItem"> | null): string | null {
  try {
    return store?.getItem(RETENTION_RUN_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Stores the run's time; a blocked or full storage is ignored (the next open runs again). */
export function markRun(store: Pick<Storage, "setItem"> | null, nowMs: number): void {
  try {
    store?.setItem(RETENTION_RUN_KEY, String(nowMs));
  } catch {
    // ignored: due again at the next open
  }
}

/** savedAt's setter for clips marked `gemt ✓` before this slice: their 24 h start now, never at once. */
export function missingSavedAt(entries: readonly ClipIndexEntry[], now: Date): ClipIndexEntry[] {
  return entries.filter((e) => e.savedOut === true && e.savedAt === undefined).map((e) => ({ ...e, savedAt: now.toISOString() }));
}

export type RetentionSelection = {
  /** Older than the keep time. */
  readonly old: readonly ClipIndexEntry[];
  /** `gemt ✓` ≥ 24 h ago (and not already in old). */
  readonly saved: readonly ClipIndexEntry[];
};

/** What the rules delete with this keep time (weeks; null = the 8-week rule only, no 24 h rule). */
export function selectRetention(local: readonly ClipIndexEntry[], server: readonly VideoClipRow[] | null, now: Date, weeks: KeepWeeks | null): RetentionSelection {
  const rows = new Map((server ?? []).map((r) => [r.id, r]));
  const days = weeks === null ? KEEP_DAYS : Math.min(weeks * 7, KEEP_DAYS);
  const old: ClipIndexEntry[] = [];
  const saved: ClipIndexEntry[] = [];
  for (const e of local) {
    const row = rows.get(e.id);
    if (e.starred || row?.starred === true || e.state === "recording" || e.pendingTrim !== undefined || e.pendingDelete !== undefined) continue;
    const t = Date.parse(row?.recordedAt ?? e.recordedAt);
    if (!Number.isNaN(t) && now.getTime() - t > days * MS_PER_DAY) old.push(e);
    else if (weeks !== null && savedDue(e, now)) saved.push(e);
  }
  return { old, saved };
}

function savedDue(e: Pick<ClipIndexEntry, "savedOut" | "savedAt">, now: Date): boolean {
  if (e.savedOut !== true || e.savedAt === undefined) return false;
  const t = Date.parse(e.savedAt);
  return !Number.isNaN(t) && now.getTime() - t >= SAVED_KEEP_MS;
}

export function selectionIds(s: RetentionSelection): string[] {
  return [...s.old, ...s.saved].map((e) => e.id);
}

function weeksText(w: KeepWeeks): string {
  return w === 1 ? "1 uge" : `${w} uger`;
}

/** §4: "Oprydning sletter 7 klip: 5 ældre end 2 uger, 2 gemt for over et døgn siden. ★ beholdes." (a 0 part left out). */
export function retentionPrompt(old: number, saved: number, weeks: KeepWeeks): string {
  const parts: string[] = [];
  if (old > 0) parts.push(`${old} ældre end ${weeksText(weeks)}`);
  if (saved > 0) parts.push(`${saved} gemt for over et døgn siden`);
  return `Oprydning sletter ${old + saved} klip: ${parts.join(", ")}. ★ beholdes.`;
}

/** §2: the space line's sentence after "544 MB af 10,7 GB · " (★ is rendered as the icon by the caller). */
export function spaceRule(r: Retention): { readonly text: string } {
  return r.kind === "on" ? { text: `ældre end ${weeksText(r.weeks)} slettes, gemte efter et døgn (` } : { text: "ældre end 8 uger slettes automatisk (" };
}

/** §2: the muted line under the row when the choice would delete clips. */
export function nextCleanupLine(n: number): string | null {
  return n > 0 ? `Næste oprydning sletter ${n} klip.` : null;
}

/** §4: the cleanup line after a silent cleanup under the new rules. */
export function retentionCleanupLine(n: number): string | null {
  return n > 0 ? `Oprydning i dag: ${n} klip slettet.` : null;
}

/** §3: "slettes om 18 t" (rounded down; under 1 h; due); null for ★ or not saved or the rules off. */
export function deleteInText(e: Pick<ClipIndexEntry, "savedOut" | "savedAt" | "starred">, now: Date, on: boolean): { readonly text: string; readonly sr: string } | null {
  if (!on || e.starred || e.savedOut !== true || e.savedAt === undefined) return null;
  const t = Date.parse(e.savedAt);
  if (Number.isNaN(t)) return null;
  const left = t + SAVED_KEEP_MS - now.getTime();
  if (left <= 0) return { text: "slettes ved næste åbning", sr: "slettes ved næste åbning" };
  const h = Math.floor(left / MS_PER_HOUR);
  if (h < 1) return { text: "slettes om under 1 t", sr: "slettes om under 1 time" };
  return { text: `slettes om ${h} t`, sr: `slettes om ${h} ${h === 1 ? "time" : "timer"}` };
}

/**
 * The silent cleanup's delete (no Fortryd: §5): clip-delete's own flow, mark then finish at once
 * (server row, files, entry last, each under the clip's lock; ★ rechecked there). Returns the ids gone;
 * a failed row stays marked and hidden, so the next open's finishDueDeletes retries it.
 */
export async function deleteNow(deps: DeleteDeps, ids: readonly string[], batch: string, now: Date): Promise<{ readonly done: string[]; readonly failed: string[] }> {
  const { marked } = await startDelete(deps, ids, batch, now, { skipPendingTrim: true });
  const done: string[] = [];
  const failed: string[] = [];
  const at = new Date(now.getTime() + DELETE_UNDO_MS);
  for (const e of marked) {
    const r = await finishDelete(deps, e.id, at);
    if (r === "done") done.push(e.id);
    else if (r === "failed") failed.push(e.id);
  }
  return { done, failed };
}
