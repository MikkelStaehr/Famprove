/**
 * The clip editor's range rules (slice clip-handles, design/specs/clip-handles.md): the start
 * rule, the handles' limits (no cross, ≥ MIN_LEN_S), rounding to 0.1 s, the key steps, and the one
 * validation the server action and the editor share, so they always agree. Pure.
 */
import type { VideoClipRow } from "./clips.ts";
import { isClipId } from "./clips.ts";
import { cutRange } from "./cut.ts";

/** The shortest range the editor and the server allow (s). */
export const MIN_LEN_S = 1;
/** ←/→ (s). */
export const SMALL_STEP_S = 0.1;
/** PageUp/PageDown and Shift+←/→ (s). */
export const BIG_STEP_S = 1;

export type Handle = "in" | "out";
export type ClipRangeS = { readonly inS: number; readonly outS: number };

/** Seconds rounded to 0.1 s (as tenths, so 0.1 + 0.2 is 0.3). */
export function roundTenth(s: number): number {
  return Math.round(s * 10) / 10;
}

const tenths = (s: number): number => Math.round(s * 10);

/** §1's start rule: the user's in/out, else the clipped auto range, else 0 and the duration; clamped to the duration. */
export function startRange(row: Pick<VideoClipRow, "clipInS" | "clipOutS" | "autoInS" | "autoOutS" | "autoStatus" | "durationS">): ClipRangeS {
  const r = cutRange(row, "mp4").range;
  const dur = roundTenth(row.durationS);
  if (r === null) return { inS: 0, outS: dur };
  const outS = Math.min(roundTenth(r.outS), dur);
  const inS = Math.max(0, Math.min(roundTenth(r.inS), roundTenth(outS - MIN_LEN_S)));
  return { inS, outS };
}

/** A handle's slider limits: Start 0 … out − 1, Slut in + 1 … duration (aria-valuemin/max). */
export function handleLimits(handle: Handle, range: ClipRangeS, durationS: number): { readonly min: number; readonly max: number } {
  if (handle === "in") return { min: 0, max: Math.max(0, roundTenth(range.outS - MIN_LEN_S)) };
  return { min: Math.min(roundTenth(durationS), roundTenth(range.inS + MIN_LEN_S)), max: roundTenth(durationS) };
}

/** Moves one handle to t (s): rounded to 0.1, stopped at its limits, so the handles never cross. */
export function moveHandle(range: ClipRangeS, handle: Handle, t: number, durationS: number): ClipRangeS {
  if (!Number.isFinite(t)) return range;
  const { min, max } = handleLimits(handle, range, durationS);
  const v = roundTenth(Math.min(max, Math.max(min, t)));
  return handle === "in" ? { inS: v, outS: range.outS } : { inS: range.inS, outS: v };
}

/** A key's move: a step (s), or to a limit; null for any other key. */
export type KeyMove = { readonly kind: "step"; readonly by: number } | { readonly kind: "limit"; readonly to: "min" | "max" };

export function keyMove(key: string, shift: boolean): KeyMove | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return { kind: "step", by: shift ? BIG_STEP_S : SMALL_STEP_S };
    case "ArrowLeft":
    case "ArrowDown":
      return { kind: "step", by: shift ? -BIG_STEP_S : -SMALL_STEP_S };
    case "PageUp":
      return { kind: "step", by: BIG_STEP_S };
    case "PageDown":
      return { kind: "step", by: -BIG_STEP_S };
    case "Home":
      return { kind: "limit", to: "min" };
    case "End":
      return { kind: "limit", to: "max" };
    default:
      return null;
  }
}

/** Applies a key's move to one handle. */
export function applyKey(range: ClipRangeS, handle: Handle, move: KeyMove, durationS: number): ClipRangeS {
  const now = handle === "in" ? range.inS : range.outS;
  if (move.kind === "step") return moveHandle(range, handle, now + move.by, durationS);
  const lim = handleLimits(handle, range, durationS);
  return moveHandle(range, handle, move.to === "min" ? lim.min : lim.max, durationS);
}

/** A stored range: both numbers (rounded to 0.1), or both null (no user range). */
export type StoredRange = { readonly inS: number; readonly outS: number } | { readonly inS: null; readonly outS: null };

/**
 * The one validation (server and editor): both null, or both finite numbers that, rounded to 0.1,
 * give 0 ≤ in < out, out − in ≥ MIN_LEN_S and out ≤ the duration (when known; the server reads
 * duration_s). Anything else (one null, a string, NaN, Infinity) is null = refused.
 */
export function validateClipRange(inS: unknown, outS: unknown, durationS: number | null): StoredRange | null {
  if (inS === null && outS === null) return { inS: null, outS: null };
  if (typeof inS !== "number" || typeof outS !== "number" || !Number.isFinite(inS) || !Number.isFinite(outS)) return null;
  const a = tenths(inS);
  const b = tenths(outS);
  if (a < 0 || a >= b || b - a < tenths(MIN_LEN_S)) return null;
  if (durationS !== null && (!Number.isFinite(durationS) || b > tenths(durationS))) return null;
  return { inS: a / 10, outS: b / 10 };
}

export type SetClipRangeInput = { readonly id: string; readonly inS: unknown; readonly outS: unknown };

/** The action's shape check: a clip id and the two values (checked by validateClipRange). */
export function parseSetClipRangeInput(raw: unknown): SetClipRangeInput | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>; // narrowed field by field below
  if (!isClipId(r.id) || !("inS" in r) || !("outS" in r)) return null;
  return { id: r.id, inS: r.inS, outS: r.outS };
}

/** setClipRange's reply: the stored values, or why nothing was written. */
export type SetClipRangeResult =
  | { readonly ok: true; readonly dev: boolean; readonly inS: number | null; readonly outS: number | null }
  | { readonly ok: false; readonly reason: "invalid" | "range" | "not_found" | "not_allowed" | "failed" };

/** §3's line under the editor's buttons for a refused or failed save. */
export function rangeErrorLine(reason: "invalid" | "range" | "not_found" | "not_allowed" | "failed" | "network"): string {
  if (reason === "failed" || reason === "network") return "Klippet blev ikke gemt. Tjek forbindelsen og prøv igen.";
  if (reason === "not_found") return "Klippet kan ikke gemmes, fordi videoen ikke findes på serveren. Gem og Del giver hele videoen.";
  return "Klippet kan ikke gemmes. Prøv at flytte håndtagene.";
}

/** The `clips` fixture's clip whose save fails (§5: the failed line can be shot): its 4th row, the first MP4 without a range. */
export const FIXTURE_FAILING_RANGE_ID = "00000000-0000-4000-8000-000000000004";
