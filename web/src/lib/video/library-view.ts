/**
 * The Optagelser card's rows (slice video-library, design/specs/video-library.md §5–§8): the
 * phone's clip index joined with public.video_clips, newest first. Pure; the card only renders.
 *  - clip: a file on the phone (done), with a row or not yet synced;
 *  - afbrudt: the page died mid-recording (no row, no ★);
 *  - missing: a row with no file on this phone ("fil mangler", Slet only, R2);
 *  - remote: a browser with no clip index (the desktop) lists rows read-only, "på telefonen".
 */
import type { IsoDate } from "../db/rows.ts";
import type { VideoClipRow } from "./clips.ts";
import type { ClipIndexEntry } from "./index-store.ts";
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
  readonly exercise: string; // the exercise's name ("Optagelse" when unknown: a clip with no row yet)
  readonly variant: string | null; // display name, shown above the exercise name
  readonly date: IsoDate;
  readonly set: number;
  readonly durationS: number | null;
  readonly starred: boolean; // the local ★ wins over the server's
  readonly starUnsynced: boolean;
  readonly recordedAt: string;
  readonly meta: string; // MonoCaption under the name stack
  readonly sr: string; // the row button's accessible name
};

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

function names(row: VideoClipRow | undefined, n: ClipNames): { exercise: string; variant: string | null } {
  if (row === undefined) return { exercise: UNKNOWN_NAME, variant: null };
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
): LibraryRow[] {
  const rows = new Map((server ?? []).map((r) => [r.id, r]));
  const out: LibraryRow[] = [];
  if (local === null) {
    for (const r of server ?? []) {
      const nm = names(r, n);
      const label = shownName(nm);
      out.push({
        id: r.id, kind: "remote", ext: null, ...nm, date: r.date, set: r.set, durationS: r.durationS,
        starred: r.starred, starUnsynced: false, recordedAt: r.recordedAt,
        meta: `${clipDay(r.date)} · sæt ${r.set} · ${clipDuration(r.durationS)} · på telefonen`,
        sr: `${label}, sæt ${r.set}, ${clipDayLong(r.date)}, på telefonen.`,
      });
    }
  } else {
    const localIds = new Set(local.map((e) => e.id));
    for (const e of local) {
      if (e.state === "recording") continue; // the recorder owns it
      const r = rows.get(e.id);
      const nm = names(r, n);
      const label = shownName(nm);
      const date = r?.date ?? e.setKey.date;
      const set = r?.set ?? e.setKey.set;
      const durationS = r?.durationS ?? e.durationS;
      const dur = durationS === null ? null : clipDuration(durationS);
      const afbrudt = e.state === "afbrudt";
      const starUnsynced = !afbrudt && e.starred !== (r?.starred ?? false) && !e.starSynced;
      const meta = afbrudt
        ? `sæt ${set} · afbrudt${dur === null ? "" : ` · ${dur}`}`
        : `${clipDay(date)} · sæt ${set}${dur === null ? "" : ` · ${dur}`}`;
      out.push({
        id: e.id, kind: afbrudt ? "afbrudt" : "clip", ext: e.ext, ...nm, date, set, durationS,
        starred: !afbrudt && e.starred, starUnsynced, recordedAt: r?.recordedAt ?? e.recordedAt, meta,
        sr: `Afspil ${label}, sæt ${set}, ${clipDayLong(date)}${durationS === null ? "" : `, ${spokenDuration(durationS)}`}${afbrudt ? ", afbrudt" : ""}.`,
      });
    }
    for (const r of server ?? []) {
      if (localIds.has(r.id)) continue;
      const nm = names(r, n);
      out.push({
        id: r.id, kind: "missing", ext: null, ...nm, date: r.date, set: r.set, durationS: r.durationS,
        starred: r.starred, starUnsynced: false, recordedAt: r.recordedAt, meta: "fil mangler",
        sr: `Slet oplysningen om ${shownName(nm)}, sæt ${r.set}, ${clipDayLong(r.date)}`,
      });
    }
  }
  return out.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : a.id.localeCompare(b.id)));
}

/** The card's first rows (R3: 3, then "Vis alle n"). */
export const FIRST_ROWS = 3;

/** Stars saved on the phone the server hasn't confirmed: resent on the next open (§6). */
export function pendingStars(local: readonly ClipIndexEntry[]): ClipIndexEntry[] {
  return local.filter((e) => e.state === "done" && !e.starSynced);
}

/** Clips whose row insert failed (video-record §8): retried by the cleanup. */
export function unsyncedClips(local: readonly ClipIndexEntry[]): ClipIndexEntry[] {
  return local.filter((e) => e.state === "done" && e.synced === false && e.durationS !== null);
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
