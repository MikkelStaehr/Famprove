import type { SetTapKind, SetState } from "./set-taps.ts";

/**
 * Which ticks were made by a tap in this page session (DESIGN.md Part B "Motion": the check draws
 * and the set dot pops only for a tap, never on first paint). Ticks restored from the set log on
 * load or reload are never fresh: the set starts empty and only `freshAfterTap` adds to it.
 * Pure, so `node --test` holds the rule.
 */
export type FreshTicks = ReadonlySet<string>;

/** The set at load: empty, whatever the log holds. */
export function initialFresh(): FreshTicks {
  return new Set();
}

/** A done tap makes its set fresh; an undo or a skip takes the flag away (no reverse motion, T3). */
export function freshAfterTap(fresh: FreshTicks, kind: SetTapKind, key: string): FreshTicks {
  if (kind === "done") return fresh.has(key) ? fresh : new Set(fresh).add(key);
  if ((kind === "undo" || kind === "skip") && fresh.has(key)) {
    const next = new Set(fresh);
    next.delete(key);
    return next;
  }
  return fresh;
}

/** The tick (and its dot) plays the draw / pop: done now, and done by a tap in this session. */
export function tickAnimates(fresh: FreshTicks, key: string, state: SetState): boolean {
  return state === "done" && fresh.has(key);
}
