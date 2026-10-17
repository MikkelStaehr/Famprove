/**
 * DEV_FIXTURE=clips (video-library.md §States): 5 clips (2 today, 1 starred), 1 afbrudt and 1
 * "fil mangler", relative to the shown day. Illustrative, never real; no video file exists, so
 * the player shows "Testvisning: ingen video". Nothing is written, deleted or shared.
 */
import { addDays } from "../dates.ts";
import type { IsoDate } from "../db/rows.ts";
import type { VideoClipRow } from "./clips.ts";
import type { ClipIndexEntry } from "./index-store.ts";
import type { ClipNames } from "./library-view.ts";

export const FIXTURE_NAMES: ClipNames = {
  exercises: { 1: "Squat", 2: "Bench Press", 3: "Deadlift" },
  variants: { 10: "Pause Squat" },
};

type Spec = { day: number; hour: string; ex: number; variant: number | null; set: number; dur: number; starred: boolean };

const SPECS: readonly Spec[] = [
  { day: 0, hour: "10:42", ex: 1, variant: 10, set: 2, dur: 48, starred: false },
  { day: 0, hour: "10:31", ex: 1, variant: 10, set: 1, dur: 41, starred: false },
  { day: -2, hour: "17:05", ex: 2, variant: null, set: 3, dur: 52, starred: true },
  { day: -5, hour: "09:20", ex: 3, variant: null, set: 1, dur: 37, starred: false },
  { day: -9, hour: "18:12", ex: 2, variant: null, set: 2, dur: 44, starred: false },
];

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function clipsFixture(today: IsoDate): { readonly rows: VideoClipRow[]; readonly local: ClipIndexEntry[] } {
  const rows: VideoClipRow[] = SPECS.map((s, i) => {
    const date = addDays(today, s.day);
    return {
      id: id(i + 1), date, session: 1, row: 10 + i, set: s.set, exerciseId: s.ex, variantId: s.variant,
      recordedAt: `${date}T${s.hour}:00+02:00`, durationS: s.dur, starred: s.starred, clipInS: null, clipOutS: null,
    };
  });
  const local: ClipIndexEntry[] = rows.map((r) => ({
    id: r.id, setKey: { date: r.date, sessionNo: r.session, row: r.row, set: r.set }, ext: "mp4",
    recordedAt: r.recordedAt, durationS: r.durationS, starred: r.starred, starSynced: true, state: "done",
  }));
  const afbrudtDate = addDays(today, -1);
  local.push({
    id: id(6), setKey: { date: afbrudtDate, sessionNo: 1, row: 20, set: 2 }, ext: "mp4",
    recordedAt: `${afbrudtDate}T16:40:00+02:00`, durationS: 31, starred: false, starSynced: true, state: "afbrudt",
  });
  const missingDate = addDays(today, -12);
  rows.push({
    id: id(7), date: missingDate, session: 2, row: 12, set: 2, exerciseId: 1, variantId: null,
    recordedAt: `${missingDate}T17:30:00+02:00`, durationS: 50, starred: false, clipInS: null, clipOutS: null,
  });
  return { rows, local };
}

/** The fixture's sizes (bytes) per clip, for the space line. */
export const FIXTURE_CLIP_BYTES = 68_000_000;
