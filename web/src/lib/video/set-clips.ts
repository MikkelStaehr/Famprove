/**
 * The Klip row (slice clip-at-set, design/specs/clip-at-set.md §1–§2): which sets of a session get
 * a ▶, from the library's own rows (libraryRows: pending deletes already out, the cut's length,
 * the run's set numbers), so Træning, the week card and Optagelser never disagree. Pure.
 */
import type { IsoDate } from "../db/rows.ts";
import { type LibraryRow, shownName } from "./library-view.ts";

export type SetClipButton = {
  readonly id: string;
  readonly set: number; // the run's set number, as the library shows it
  readonly nth: number; // 1 for the set's first clip (oldest first), 2 for the next …
  readonly label: string; // "sæt 2", "sæt 2 (2)"
  readonly name: string; // the accessible name
};

/** Only a clip whose file is on this phone (kind clip with a file): no ▶ for a row without one (§4). */
export function setClipButtons(rows: readonly LibraryRow[], date: IsoDate, session: number, sheetRows: readonly number[]): SetClipButton[] {
  const wanted = new Set(sheetRows);
  const mine = rows
    .filter((r) => r.kind === "clip" && r.file !== null && r.date === date && r.session === session && wanted.has(r.sheetRow))
    .toSorted((a, b) => a.set - b.set || (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : a.id.localeCompare(b.id)));
  // Counted per (sheet row, set): the same as per run set when the run's numbers are known, and still
  // right when they aren't (each row's own set numbers then repeat across the run's rows; review).
  const seen = new Map<string, number>();
  return mine.map((r) => {
    const key = `${r.sheetRow}:${r.set}`;
    const nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, nth);
    return { id: r.id, set: r.set, nth, label: clipButtonLabel(r.set, nth), name: clipButtonName(shownName(r), r.set, nth) };
  });
}

/** "sæt 2"; the set's second clip on "sæt 2 (2)". */
export function clipButtonLabel(set: number, nth: number): string {
  return nth === 1 ? `sæt ${set}` : `sæt ${set} (${nth})`;
}

/** "Afspil klip af Squat, sæt 2"; "Afspil klip 2 af Squat, sæt 2". */
export function clipButtonName(name: string, set: number, nth: number): string {
  return `Afspil klip${nth === 1 ? "" : ` ${nth}`} af ${name}, sæt ${set}`;
}
