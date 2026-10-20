/**
 * The Optagelser card's rows (slice video-library, design/specs/video-library.md §5–§8): the
 * phone's clip index joined with public.video_clips, newest first. Pure; the card only renders.
 *  - clip: a file on the phone (done), with a row or not yet synced;
 *  - afbrudt: the page died mid-recording (no row, no ★);
 *  - missing: a row with no file on this phone ("fil mangler", Slet only, R2);
 *  - remote: a browser with no clip index (the desktop) lists rows read-only, "på telefonen".
 */
import { isoWeekStart } from "../dates.ts";
import type { IsoDate } from "../db/rows.ts";
import { runPositions } from "../training-view.ts";
import type { VideoClipRow } from "./clips.ts";
import { clipFile, clipFiles, type ClipIndexEntry, type ClipNameStack } from "./index-store.ts";
import type { ClipExt } from "./mime.ts";

export type ClipNames = {
  readonly exercises: Readonly<Record<number, string>>;
  readonly variants: Readonly<Record<number, string>>;
};

export type LibraryRowKind = "clip" | "afbrudt" | "missing" | "remote";

export type LibraryRow = {
  readonly id: string;
  readonly kind: LibraryRowKind;
  readonly ext: ClipExt | null; // null without a local file
  /** The local file to read (clipFile(entry), slice clip-trim); null without one. */
  readonly file: string | null;
  /** Every local file of the clip (clipFiles(entry)): what deleting it removes; empty without one. */
  readonly files: readonly string[];
  readonly exercise: string; // the exercise's name ("Optagelse" when unknown: a clip with no row yet)
  readonly variant: string | null; // display name, shown above the exercise name
  readonly date: IsoDate;
  readonly set: number; // across the exercise's run, as Fokus's "Sæt n" (RunSets); else the sheet row's set_no
  readonly durationS: number | null;
  readonly starred: boolean; // the local ★ wins over the server's
  readonly starUnsynced: boolean;
  readonly recordedAt: string;
  readonly meta: string; // MonoCaption under the name stack
  readonly sr: string; // the row button's accessible name
  /** `gemt ✓` (slice clip-delete): saved or shared from the app; absent = not. */
  readonly saved?: boolean;
};

/**
 * A clip's set as Fokus numbers it (slice clip-set-no; traening.md D11 "Sæt n af N"): across the
 * exercise's run, keyed by runSetKey. A set whose week is not in strength_sets (an old week gone
 * from the sheet) has no entry: the card shows the sheet row's set_no, as before.
 */
export type RunSets = Readonly<Record<string, number>>;

/** One strength_sets row of a session, as the run numbering needs it. */
export type SessionSetRow = {
  readonly weekStart: IsoDate;
  readonly session: number;
  readonly block: string;
  readonly row: number;
  readonly set: number;
  readonly name: string;
  readonly variantId: number | null;
};

export function runSetKey(date: IsoDate, session: number, row: number, set: number): string {
  return `${isoWeekStart(date)}#${session}#${row}#${set}`;
}

/** Every set's run number per (week, session): Fokus's rows (block, sheet row, set order) through runPositions. */
export function runSetNumbers(sets: readonly SessionSetRow[]): Record<string, number> {
  const sessions = new Map<string, SessionSetRow[]>();
  for (const s of sets) {
    const k = `${s.weekStart}#${s.session}`;
    sessions.set(k, [...(sessions.get(k) ?? []), s]);
  }
  const out: Record<string, number> = {};
  for (const rows of sessions.values()) {
    const ordered = rows.toSorted((a, b) => a.block.localeCompare(b.block) || a.row - b.row || a.set - b.set);
    const exercises: { name: string; variantId: number | null; sets: { row: number; set: number }[]; key: string }[] = [];
    for (const s of ordered) {
      const key = `${s.block}#${s.row}`;
      const last = exercises.at(-1);
      if (last !== undefined && last.key === key) last.sets.push({ row: s.row, set: s.set });
      else exercises.push({ key, name: s.name, variantId: s.variantId, sets: [{ row: s.row, set: s.set }] });
    }
    const positions = runPositions(exercises);
    for (const s of ordered) {
      const p = positions.get(`${s.row}#${s.set}`);
      if (p !== undefined) out[runSetKey(s.weekStart, s.session, s.row, s.set)] = p.index;
    }
  }
  return out;
}

/** Unknown name: a clip whose row isn't on the server (yet). */
export const UNKNOWN_NAME = "Optagelse";

const WEEKDAY = new Intl.DateTimeFormat("da-DK", { weekday: "short", timeZone: "UTC" });
const DAY_MONTH_SHORT = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_MONTH_LONG = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "long", timeZone: "UTC" });

function utc(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** "lør. 17. okt" (the spec's meta date: weekday with its dot, month without). */
export function clipDay(date: IsoDate): string {
  const wd = WEEKDAY.format(utc(date)).replace(/\.$/, "");
  return `${wd}. ${DAY_MONTH_SHORT.format(utc(date)).replace(/\.$/, "")}`;
}

/** "17. oktober" for the screen reader. */
export function clipDayLong(date: IsoDate): string {
  return DAY_MONTH_LONG.format(utc(date));
}

/** "0:48", "12:05"; whole seconds, rounded. */
export function clipDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function spokenDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  const sec = `${rest} ${rest === 1 ? "sekund" : "sekunder"}`;
  if (m === 0) return sec;
  const min = `${m} ${m === 1 ? "minut" : "minutter"}`;
  return rest === 0 ? min : `${min} og ${sec}`;
}

/** What the screen reader and the share file call the clip: the variant when set, else the exercise. */
export function shownName(row: Pick<LibraryRow, "exercise" | "variant">): string {
  return row.variant ?? row.exercise;
}

/** The server row's names; without a row (afbrudt, not yet synced) the stack stored at Optag, else UNKNOWN_NAME. */
function names(row: VideoClipRow | undefined, n: ClipNames, atOptag?: ClipNameStack): { exercise: string; variant: string | null } {
  if (row === undefined) {
    if (atOptag === undefined) return { exercise: UNKNOWN_NAME, variant: null };
    const v = atOptag.variant;
    return { exercise: atOptag.exercise, variant: v === null || v === atOptag.exercise ? null : v };
  }
  const exercise = n.exercises[row.exerciseId] ?? UNKNOWN_NAME;
  const v = row.variantId === null ? null : (n.variants[row.variantId] ?? null);
  return { exercise, variant: v === null || v === exercise ? null : v };
}

/**
 * local null: this browser has no clip index (never recorded); every row is `remote`.
 * server null: the rows could not be read; the local clips show, by their own data.
 */
export function libraryRows(
  local: readonly ClipIndexEntry[] | null,
  server: readonly VideoClipRow[] | null,
  n: ClipNames,
  runSets: RunSets = {},
): LibraryRow[] {
  const rows = new Map((server ?? []).map((r) => [r.id, r]));
  // The run's set number (Fokus's "Sæt n"); without the week's rows the sheet row's set_no.
  const shownSet = (date: IsoDate, session: number, row: number, set: number): number => runSets[runSetKey(date, session, row, set)] ?? set;
  const out: LibraryRow[] = [];
  if (local === null) {
    for (const r of server ?? []) {
      const nm = names(r, n);
      const label = shownName(nm);
      const set = shownSet(r.date, r.session, r.row, r.set);
      out.push({
        id: r.id, kind: "remote", ext: null, file: null, files: [], ...nm, date: r.date, set, durationS: r.durationS,
        starred: r.starred, starUnsynced: false, recordedAt: r.recordedAt,
        meta: `${clipDay(r.date)} · sæt ${set} · ${clipDuration(r.durationS)} · på telefonen`,
        sr: `${label}, sæt ${set}, ${clipDayLong(r.date)}, på telefonen.`,
      });
    }
  } else {
    const localIds = new Set(local.map((e) => e.id));
    for (const e of local) {
      if (e.state === "recording") continue; // the recorder owns it
      if (e.pendingDelete !== undefined) continue; // clip-delete: hidden until the delete finishes (its server row stays out too: localIds)
      const r = rows.get(e.id);
      const nm = names(r, n, e.names);
      const label = shownName(nm);
      const date = r?.date ?? e.setKey.date;
      const set = r === undefined ? shownSet(e.setKey.date, e.setKey.sessionNo, e.setKey.row, e.setKey.set) : shownSet(r.date, r.session, r.row, r.set);
      const durationS = e.pendingTrim !== undefined ? e.durationS : (r?.durationS ?? e.durationS); // clip-trim: the cut's length until the server has it
      const dur = durationS === null ? null : clipDuration(durationS);
      const afbrudt = e.state === "afbrudt";
      const starUnsynced = !afbrudt && e.starred !== (r?.starred ?? false) && !e.starSynced;
      const meta = afbrudt
        ? `sæt ${set} · afbrudt${dur === null ? "" : ` · ${dur}`}`
        : `${clipDay(date)} · sæt ${set}${dur === null ? "" : ` · ${dur}`}`;
      out.push({
        id: e.id, kind: afbrudt ? "afbrudt" : "clip", ext: e.ext, file: clipFile(e), files: clipFiles(e), ...nm, date, set, durationS,
        starred: !afbrudt && e.starred, starUnsynced, recordedAt: r?.recordedAt ?? e.recordedAt, meta, saved: e.savedOut === true,
        sr: `Afspil ${label}, sæt ${set}, ${clipDayLong(date)}${durationS === null ? "" : `, ${spokenDuration(durationS)}`}${afbrudt ? ", afbrudt" : ""}.`,
      });
    }
    for (const r of server ?? []) {
      if (localIds.has(r.id)) continue;
      const nm = names(r, n);
      const set = shownSet(r.date, r.session, r.row, r.set);
      out.push({
        id: r.id, kind: "missing", ext: null, file: null, files: [], ...nm, date: r.date, set, durationS: r.durationS,
        starred: r.starred, starUnsynced: false, recordedAt: r.recordedAt, meta: "fil mangler",
        sr: `Slet oplysningen om ${shownName(nm)}, sæt ${set}, ${clipDayLong(r.date)}`,
      });
    }
  }
  return out.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : a.id.localeCompare(b.id)));
}

/** The card's first rows (R3: 3, then "Vis alle n"). */
export const FIRST_ROWS = 3;

/** video-library.md §8: a fil mangler row's failed delete (user 2026-10-18); the row and its Slet stay. */
export const MISSING_DELETE_FAILED = "Klippet blev ikke slettet. Prøv igen.";

/** Stars saved on the phone the server hasn't confirmed: resent on the next open (§6). */
export function pendingStars(local: readonly ClipIndexEntry[]): ClipIndexEntry[] {
  return local.filter((e) => e.state === "done" && !e.starSynced);
}

/** Clips whose row insert failed (video-record §8): retried by the cleanup. */
export function unsyncedClips(local: readonly ClipIndexEntry[]): ClipIndexEntry[] {
  return local.filter((e) => e.state === "done" && e.synced === false && e.durationS !== null && e.syncRefused === undefined && e.pendingTrim === undefined);
}

/** The player's history entry (video-library §10): pushed once on open, so the back gesture closes it. */
export const PLAYER_HISTORY_STATE = "clipPlayer";

export function isPlayerEntry(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as Record<string, unknown>)[PLAYER_HISTORY_STATE] === true; // history.state is untyped
}

/**
 * Luk and Escape: "back" while the player's entry is on top (popstate then closes the player, so the
 * entry is not left behind); else "close" at once. The back gesture's popstate always just closes.
 */
export function playerCloseVia(state: unknown): "back" | "close" {
  return isPlayerEntry(state) ? "back" : "close";
}

/** On open: push the entry unless it is already on top (a re-run effect, e.g. React's dev double mount). */
export function playerShouldPush(state: unknown): boolean {
  return !isPlayerEntry(state);
}

/** The cleanup runs once a day (a local timestamp, Copenhagen's date). */
export function cleanupDue(lastRun: IsoDate | null, today: IsoDate): boolean {
  return lastRun === null || lastRun < today;
}

/** "23 klip". */
export function clipCount(n: number): string {
  return `${n} klip`;
}

/** "3 optagelser ældre end 8 uger blev slettet i dag." (§4); null when nothing was deleted. */
export function cleanupLine(deleted: number): string | null {
  if (deleted <= 0) return null;
  return `${deleted} ${deleted === 1 ? "optagelse" : "optagelser"} ældre end 8 uger blev slettet i dag.`;
}

/** Used = the sum of this phone's clips; null when a size is unknown (never 0 for unknown). */
export function usedBytes(sizes: readonly (number | null)[]): number | null {
  let sum = 0;
  for (const s of sizes) {
    if (s === null) return null;
    sum += s;
  }
  return sum;
}
