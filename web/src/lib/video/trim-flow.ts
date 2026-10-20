/**
 * The player's and the editor's Gem klip flow (slice clip-trim, design/specs/clip-trim.md §2–§5):
 * the pending points, the cut's states and their lines. Pure; the cut itself is trim.ts (startTrim,
 * undoTrim, finishTrim), run by ClipLibrary. Start her and Slut her only move pending points: nothing
 * here (or in the marks) writes.
 */
import type { VideoClipRow } from "./clips.ts";
import { MIN_LEN_S, roundTenth, validateClipRange } from "./clip-range.ts";
import { formatRange, formatSeconds } from "./cut-lines.ts";
import { formatBytes } from "./space.ts";

/** A length as `m:ss,d` always (`0:36,2`), the done lines' format (§1). */
export function clockLength(s: number): string {
  const tenths = Math.max(0, Math.round(s * 10));
  const m = Math.floor(tenths / 600);
  const sec = ((tenths - m * 600) / 10).toFixed(1).replace(".", ",");
  return `${m}:${sec.padStart(4, "0")}`;
}

/** The pending points: in and out, each null until set. */
export type Points = { readonly inS: number | null; readonly outS: number | null };
export const NO_POINTS: Points = { inS: null, outS: null };

/** §5: an old stored range (clip-mark / clip-handles) opens as pending points; the auto range never does. */
export function storedPoints(row: Pick<VideoClipRow, "clipInS" | "clipOutS"> | null): Points {
  return row !== null && row.clipInS !== null && row.clipOutS !== null ? { inS: row.clipInS, outS: row.clipOutS } : NO_POINTS;
}

/** §2.2: the valid cut of the points (out − in ≥ 1,0 within the duration), else null. */
export function cutPoints(p: Points, durationS: number): { readonly inS: number; readonly outS: number } | null {
  if (p.outS === null) return null;
  const v = validateClipRange(p.inS ?? 0, p.outS, durationS);
  return v === null || v.inS === null ? null : { inS: v.inS, outS: v.outS };
}

/** §2.1 Start her at t: a new in; an out less than 1,0 s after it is cleared (`cleared`). */
export function startAt(p: Points, t: number): { readonly points: Points; readonly cleared: boolean } {
  const inS = roundTenth(t);
  const cleared = p.outS !== null && p.outS - inS < MIN_LEN_S - 1e-9;
  return { points: { inS, outS: cleared ? null : p.outS }, cleared };
}

/** §2.2 Slut her at t: the new points (in = the pending Start, else 0), or refused (nothing set). */
export function endAt(p: Points, t: number, durationS: number): { readonly kind: "ok"; readonly points: Points } | { readonly kind: "refused"; readonly inS: number } {
  const inS = p.inS ?? 0;
  const c = cutPoints({ inS, outS: roundTenth(Math.min(Math.max(0, t), durationS)) }, durationS);
  return c === null ? { kind: "refused", inS } : { kind: "ok", points: c };
}

/** The cut's state in the player. `left`: Fortryd's seconds; `finished`: the original is gone (Fortryd went). */
export type TrimState =
  | { readonly kind: "idle" }
  | { readonly kind: "cutting"; readonly inS: number; readonly outS: number }
  | { readonly kind: "done"; readonly fromS: number | null; readonly toS: number; readonly deadline: string }
  | { readonly kind: "finished"; readonly toS: number; readonly freed: number | null }
  | { readonly kind: "undone"; readonly fromS: number | null }
  /** At 0 the server refused for good: the original is the clip again. */
  | { readonly kind: "refused" }
  | { readonly kind: "failed"; readonly space: boolean; readonly inS: number; readonly outS: number };

export type TrimEvent =
  | { readonly kind: "cut"; readonly inS: number; readonly outS: number }
  | { readonly kind: "result"; readonly result: { readonly kind: "done"; readonly fromS: number | null; readonly toS: number; readonly deadline: string } | { readonly kind: "failed"; readonly space: boolean } }
  | { readonly kind: "finished"; readonly freed: number | null }
  | { readonly kind: "refused" }
  | { readonly kind: "undone"; readonly fromS: number | null };

/** The flow: idle/failed/undone/finished/refused → cutting → done | failed; done → finished (at 0) | refused (at 0) | undone (Fortryd). */
export function trimStep(s: TrimState, e: TrimEvent): TrimState {
  switch (e.kind) {
    case "cut":
      return s.kind === "cutting" ? s : { kind: "cutting", inS: e.inS, outS: e.outS };
    case "result":
      if (s.kind !== "cutting") return s;
      return e.result.kind === "done"
        ? { kind: "done", fromS: e.result.fromS, toS: e.result.toS, deadline: e.result.deadline }
        : { kind: "failed", space: e.result.space, inS: s.inS, outS: s.outS };
    case "finished":
      return s.kind === "done" ? { kind: "finished", toS: s.toS, freed: e.freed } : s;
    case "undone":
      return s.kind === "done" ? { kind: "undone", fromS: e.fromS } : s;
    case "refused":
      return s.kind === "done" ? { kind: "refused" } : s;
  }
}

/** Fortryd's count (whole seconds, ≥ 0). */
export function secondsLeft(deadline: string, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - nowMs) / 1000));
}

export const CUTTING_LINE = "Klipper …";
export const GEM_KLIP = "Gem klip";
export const CANCEL = "Annullér";

/** §2.2: the cut line while both points are pending. */
export function pointsLine(inS: number, outS: number): string {
  return `Start ${formatSeconds(inS)} · Slut ${formatSeconds(outS)} · ${formatSeconds(outS - inS)}`;
}

/** §5: an old stored range, not cut yet. */
export function storedLine(inS: number, outS: number): string {
  return `Dit klip ${formatRange(inS, outS)} · ikke klippet endnu`;
}

export const OUT_CLEARED_LINE = "Slut ryddet: den lå før start.";

/** §2.3 done (the visible part before Fortryd). */
export function doneLine(toS: number, fromS: number | null): string {
  return fromS === null ? `Klippet til ${clockLength(toS)}` : `Klippet til ${clockLength(toS)} (fra ${clockLength(fromS)})`;
}

/** §3: the one announcement of a done cut. */
export function doneAnnouncement(toS: number): string {
  return `Klippet til ${clockLength(toS)}. Fortryd muligt i 10 sekunder.`;
}

/** §2.3 failed (shown after a ◆). */
export function failedLine(space: boolean): string {
  return `Klippet lykkedes ikke.${space ? " Telefonen mangler plads." : ""} Hele videoen er urørt.`;
}

/** §3 Fortryd's result. */
export function undoneLine(fromS: number | null): string {
  return fromS === null ? "Fortrudt · hele videoen er tilbage." : `Fortrudt · hele videoen er tilbage (${clockLength(fromS)}).`;
}

/** At 0, a permanent refusal (trim.ts finishTrim `refused`): rolled back locally. */
export const REFUSED_LINE = "Klippet kunne ikke gemmes. Hele videoen er tilbage.";

/** §3 at 0: the MB measured at render (null: not measured, no MB part). */
export function finishedLine(toS: number, freed: number | null): string {
  const mb = freed === null ? null : formatBytes(freed);
  return mb === null ? `Klippet til ${clockLength(toS)}.` : `Klippet til ${clockLength(toS)} · ${mb} frigjort.`;
}
