/**
 * Marking a clip while it plays (slice clip-mark, design/specs/clip-mark.md): Start her sets a
 * pending in point, Slut her saves in/out through setClipRange. The in rule, the refusal and the
 * lines live here; validateClipRange is the one check. Pure.
 */
import type { VideoClipRow } from "./clips.ts";
import { MIN_LEN_S, roundTenth, type StoredRange, validateClipRange } from "./clip-range.ts";
import { cutRange } from "./cut.ts";
import { formatRange, formatSeconds } from "./cut-lines.ts";

type MarkRow = Pick<VideoClipRow, "clipInS" | "clipOutS" | "autoInS" | "autoOutS" | "autoStatus" | "durationS">;

/** A tap's position (s): rounded to 0.1, at least 0 and capped at the clip's duration. */
export function markPoint(t: number, durationS: number): number {
  return roundTenth(Math.min(Math.max(0, t), durationS));
}

/** §2.2: the in point Slut uses: the pending Start, else the user's in, else the clipped auto in, else 0. */
export function markIn(row: MarkRow, pendingInS: number | null): number {
  if (pendingInS !== null) return markPoint(pendingInS, row.durationS);
  const r = cutRange(row, "mp4").range;
  return r === null ? 0 : markPoint(r.inS, row.durationS);
}

export type MarkResult =
  | { readonly kind: "ok"; readonly range: { readonly inS: number; readonly outS: number } }
  | { readonly kind: "refused"; readonly inS: number };

/** §2.2: Slut her at `nowS`: the range to send, or refused (out ≤ in or shorter than MIN_LEN_S); nothing is written when refused. */
export function markRange(row: MarkRow, pendingInS: number | null, nowS: number): MarkResult {
  const inS = markIn(row, pendingInS);
  if (!Number.isFinite(nowS)) return { kind: "refused", inS };
  const outS = markPoint(nowS, row.durationS);
  const v = validateClipRange(inS, outS, row.durationS);
  if (v === null || v.inS === null) return { kind: "refused", inS };
  return { kind: "ok", range: { inS: v.inS, outS: v.outS } };
}

/** §2.3: what Fortryd writes back: the range stored before the mark, or null/null when there was none. */
export function undoInput(row: Pick<VideoClipRow, "clipInS" | "clipOutS">): StoredRange {
  return row.clipInS !== null && row.clipOutS !== null ? { inS: row.clipInS, outS: row.clipOutS } : { inS: null, outS: null };
}

/** Start her's label after a tap (the bracket is a separate aria-hidden span). */
/** §2.1: Ryd while a mark's Fortryd is still on the line. */
export const START_CLEARED_LINE = "Start ryddet.";

export function startLabel(pendingInS: number | null): string {
  return pendingInS === null ? "Start her" : `Start ${formatSeconds(pendingInS)}`;
}

/** §2.1: the line that replaces the cut line while a Start is pending (not live). */
export function pendingLine(inS: number): string {
  return `Start ${formatSeconds(inS)} · tryk Slut her`;
}

/** §3: the status region's line after Start her. */
export function startLine(inS: number): string {
  return `Start sat ved ${formatSeconds(inS)}.`;
}

export const SAVING_LINE = "Gemmer …";

/** §2.2 refused (shown after a ◆). */
export function refusedLine(inS: number): string {
  return `Slut skal ligge mindst ${formatSeconds(MIN_LEN_S)} efter start (${formatSeconds(inS)}). Lad videoen spille videre, og tryk igen.`;
}

/** §2.2 saved. */
export function savedLine(range: { readonly inS: number; readonly outS: number }): string {
  return `Klip gemt · ${formatRange(range.inS, range.outS)}.`;
}

/** §2.3: Fortryd's result. */
export function undoneLine(prev: StoredRange): string {
  return prev.inS === null ? "Fortrudt · dit klip er fjernet." : `Fortrudt · klippet er igen ${formatRange(prev.inS, prev.outS)}.`;
}

/** §2.3: a failed Fortryd (shown after a ◆). */
export const UNDO_FAILED_LINE = "Fortryd blev ikke gemt. Tjek forbindelsen og prøv igen.";
