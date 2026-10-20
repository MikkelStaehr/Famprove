/**
 * DEV_FIXTURE=clips (video-library.md §States): 7 clips (4 today, one per set of a multi-row run; 1 starred), 1 afbrudt and 1
 * "fil mangler", relative to the shown day. Illustrative, never real; no video file exists, so
 * the player shows "Testvisning: ingen video". Nothing is written, deleted or shared.
 */
import { addDays, isoWeekStart } from "../dates.ts";
import type { IsoDate } from "../db/rows.ts";
import type { VideoClipRow } from "./clips.ts";
import type { ClipIndexEntry } from "./index-store.ts";
import { type ClipNames, type RunSets, runSetNumbers } from "./library-view.ts";

export const FIXTURE_NAMES: ClipNames = {
  exercises: { 1: "Squat", 2: "Bench Press", 3: "Deadlift" },
  variants: { 10: "Pause Squat" },
};

type Spec = { day: number; hour: string; ex: number; variant: number | null; row: number; set: number; dur: number; starred: boolean };

// Today: one clip per set of a multi-row run like 19 Oct (rows 25: 1 set, 26: 1, 27: 2), shown sæt 1–4.
const SPECS: readonly Spec[] = [
  { day: 0, hour: "10:42", ex: 1, variant: 10, row: 27, set: 2, dur: 48, starred: false },
  { day: 0, hour: "10:37", ex: 1, variant: 10, row: 27, set: 1, dur: 45, starred: false },
  { day: 0, hour: "10:34", ex: 1, variant: 10, row: 26, set: 1, dur: 43, starred: false },
  { day: 0, hour: "10:31", ex: 1, variant: 10, row: 25, set: 1, dur: 41, starred: false },
  { day: -2, hour: "17:05", ex: 2, variant: null, row: 12, set: 3, dur: 52, starred: true },
  { day: -5, hour: "09:20", ex: 3, variant: null, row: 13, set: 1, dur: 37, starred: false },
  { day: -9, hour: "18:12", ex: 2, variant: null, row: 14, set: 2, dur: 44, starred: false },
];

/** Today's session rows behind the run (illustrative): Pause Squat on rows 25, 26 and 27 (2 sets). */
export function fixtureRunSets(today: IsoDate): RunSets {
  const set = (row: number, s: number) => ({ weekStart: isoWeekStart(today), session: 1, block: "fixture", row, set: s, name: "Squat", variantId: 10 });
  return runSetNumbers([set(25, 1), set(26, 1), set(27, 1), set(27, 2)]);
}

type Cut = Pick<VideoClipRow, "clipInS" | "clipOutS" | "autoInS" | "autoOutS" | "autoStatus">;
const NO_CUT: Cut = { clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null };
/** clip-cut's player lines: the newest clip has the user's in/out, the next an automatic one; the third is WebM. */
const CUTS: readonly Cut[] = [
  { ...NO_CUT, clipInS: 12.3, clipOutS: 48 },
  { ...NO_CUT, autoInS: 4.2, autoOutS: 39.6, autoStatus: "clipped" },
];
const WEBM_INDEX = 2;

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function clipsFixture(today: IsoDate): { readonly rows: VideoClipRow[]; readonly local: ClipIndexEntry[] } {
  const rows: VideoClipRow[] = SPECS.map((s, i) => {
    const date = addDays(today, s.day);
    const cut = CUTS[i] ?? NO_CUT;
    return {
      id: id(i + 1), date, session: 1, row: s.row, set: s.set, exerciseId: s.ex, variantId: s.variant,
      recordedAt: `${date}T${s.hour}:00+02:00`, durationS: s.dur, starred: s.starred, ...cut,
    };
  });
  const local: ClipIndexEntry[] = rows.map((r, i) => ({
    id: r.id, setKey: { date: r.date, sessionNo: r.session, row: r.row, set: r.set }, ext: i === WEBM_INDEX ? "webm" : "mp4",
    recordedAt: r.recordedAt, durationS: r.durationS, starred: r.starred, starSynced: true, state: "done",
  }));
  const afbrudtDate = addDays(today, -1);
  local.push({
    id: id(8), setKey: { date: afbrudtDate, sessionNo: 1, row: 20, set: 2 }, ext: "mp4",
    recordedAt: `${afbrudtDate}T16:40:00+02:00`, durationS: 31, starred: false, starSynced: true, state: "afbrudt",
  });
  const missingDate = addDays(today, -12);
  rows.push({
    id: id(9), date: missingDate, session: 2, row: 12, set: 2, exerciseId: 1, variantId: null,
    recordedAt: `${missingDate}T17:30:00+02:00`, durationS: 50, starred: false, clipInS: null, clipOutS: null, autoInS: null, autoOutS: null, autoStatus: null,
  });
  return { rows, local };
}

/** The fixture's sizes (bytes) per clip, for the space line. */
export const FIXTURE_CLIP_BYTES = 68_000_000;
