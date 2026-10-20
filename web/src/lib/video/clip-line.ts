/**
 * clip-line (design/specs/clip-line.md): the Optagelser line under the day card and its "Alle klip"
 * sheet. Pure: which parts each row of the line holds, and the sheet's history entry.
 */

/** A part of the line: the space figure, the Auto-klip switch, Alle klip, the empty sentence, the two actions, the read error. */
export type LinePart = "space" | "switch" | "all" | "empty" | "save" | "delete" | "error";

export type LineInput = {
  /** The local index is still being read. */
  readonly loading: boolean;
  /** The local index could not be read. */
  readonly error: boolean;
  /** Every listed clip (the list the sheet shows). */
  readonly clips: number;
  /** Gem alle fra i dag's count (or Gem resten's); 0 = hidden. */
  readonly save: number;
  /** Slet gemte's count; 0 = hidden. */
  readonly deletable: number;
  /** A Fortryd window, a delete or trim line, or the save line has content. */
  readonly pending: boolean;
  /** The Alle klip sheet is open. */
  readonly sheetOpen: boolean;
};

export type LineParts = {
  readonly row1: readonly LinePart[];
  readonly row2: readonly LinePart[];
  /** Where the status row (row 3) renders: on the line, in the sheet's footer, or nowhere. Never both (§3). */
  readonly status: "line" | "sheet" | null;
};

export function lineParts(i: LineInput): LineParts {
  const status = i.pending ? (i.sheetOpen ? "sheet" : "line") : null;
  if (i.loading) return { row1: ["space", "switch", "all"], row2: [], status };
  if (i.error) return { row1: ["space", "switch", "all"], row2: ["error"], status };
  if (i.clips === 0) return { row1: ["empty", "all"], row2: [], status };
  const row2: LinePart[] = [];
  if (i.save > 0) row2.push("save");
  if (i.deletable > 0) row2.push("delete");
  return { row1: ["space", "switch", "all"], row2, status };
}

/** "Alle klip · 9"; no count when there are no clips (§4). */
export function allLabel(clips: number): string {
  return clips > 0 ? `Alle klip · ${clips}` : "Alle klip";
}

/** The sheet's history entry (like the player's): pushed once on open, so the back gesture closes it. */
export const SHEET_HISTORY_STATE = "clipSheet";

export function isSheetEntry(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as Record<string, unknown>)[SHEET_HISTORY_STATE] === true; // history.state is untyped
}

/** On open: push the entry unless it is already on top (a re-run effect, e.g. React's dev double mount). */
export function sheetShouldPush(state: unknown): boolean {
  return !isSheetEntry(state);
}

/** Luk and Escape: "back" while the sheet's entry is on top (popstate then closes it); else "close" at once. */
export function sheetCloseVia(state: unknown): "back" | "close" {
  return isSheetEntry(state) ? "back" : "close";
}

/**
 * A popstate while the sheet is open: back from the player opened over it lands on the sheet's
 * entry, so the sheet stays; any other entry closes it.
 */
export function sheetStaysOnPop(state: unknown): boolean {
  return isSheetEntry(state);
}
