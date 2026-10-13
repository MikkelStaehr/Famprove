/**
 * Fokus round 4's three generative elements (design/specs/fokus-round4.md §3), as pure geometry.
 *
 * Every number here is a DRAWING SCALE only: dot counts, bar heights, gaps and fills are computed
 * in the browser from the set log and sheet rows Fokus already has (like the rest tick's
 * position). Nothing is stored, fetched or shown as a number, and no load or metric is derived:
 * the sr sentences carry counts only. No randomness and no clock: the same input gives the same
 * output, so the markup is deterministic.
 */
import { repsRange, type FokusExercise } from "./fokus-view.ts";
import { isWarmup, type LoggedSet, type SetRef, setKey, stateOf } from "./set-taps.ts";

/* ── §3.1 The dot field (pause and warm-up) ─────────────────────────────────────────────── */

export const FIELD_COLS = 60;
export const FIELD_ROWS = 6;
export const FIELD_DOTS = FIELD_COLS * FIELD_ROWS; // 360
export const FIELD_WIDTH = 360; // viewBox units
const PITCH = 6;
const TICK_MAX_X = FIELD_WIDTH - 2; // the 2-unit tick stays inside the field

export type FieldDot = { readonly cx: number; readonly cy: number; readonly kind: "empty" | "filled" | "over" };
export type DotField = {
  readonly scaleS: number;
  readonly filled: number; // = data-filled
  readonly dots: readonly FieldDot[];
  readonly tickX: number;
  readonly minX: number | null; // null on the warm-up (no recommended rest)
  readonly maxX: number | null;
};

const xOf = (seconds: number, scaleS: number): number => Math.round(((Math.max(0, seconds) * FIELD_WIDTH) / scaleS) * 100) / 100;

/**
 * The field: 60 columns × 6 rows, one dot = scaleS / 360 s, filled column-major (top to bottom)
 * as time passes. A filled dot whose second lies at or past MAX is "over" (drawn as a ring:
 * shape, not colour). `elapsedS` is whole seconds from the timer.
 */
export function dotField(elapsedS: number, scaleS: number, minS: number | null, maxS: number | null): DotField {
  const filled = Math.min(FIELD_DOTS, Math.max(0, Math.floor((elapsedS * FIELD_DOTS) / scaleS + 1e-9)));
  const overFrom = maxS === null ? FIELD_DOTS : Math.ceil((maxS * FIELD_DOTS) / scaleS - 1e-9);
  const dots: FieldDot[] = [];
  for (let i = 0; i < FIELD_DOTS; i += 1) {
    const c = Math.floor(i / FIELD_ROWS);
    const r = i % FIELD_ROWS;
    dots.push({ cx: 3 + PITCH * c, cy: 15 + PITCH * r, kind: i >= filled ? "empty" : i >= overFrom ? "over" : "filled" });
  }
  const marks = minS !== null && maxS !== null;
  return {
    scaleS,
    filled,
    dots,
    tickX: Math.min(TICK_MAX_X, xOf(elapsedS, scaleS)),
    minX: marks ? Math.min(TICK_MAX_X, xOf(minS, scaleS)) : null,
    maxX: marks ? Math.min(FIELD_WIDTH - 1, xOf(maxS, scaleS)) : null,
  };
}

/* ── §3.2 The dot row (set view) ────────────────────────────────────────────────────────── */

export type RowDot = { readonly cx: number; readonly kind: "done" | "skipped" };
export type DotRowGroup = { readonly key: string; readonly width: number; readonly dots: readonly RowDot[] };
export type DotRow = { readonly groups: readonly DotRowGroup[]; readonly done: number; readonly skipped: number; readonly sentence: string };

type Named = Pick<FokusExercise, "name" | "row">;
const nameOf = (exercises: readonly Named[], ref: SetRef): string =>
  exercises.find((e) => e.row === ref.row)?.name.trim().toLowerCase() ?? `#${ref.row}`;

/**
 * One dot per set tapped today in this session, in sheet order (warm-ups never): done = filled,
 * skipped = ring; open sets draw nothing. Grouped per exercise run (pitch 10px, +6px between
 * groups, the gap is the layout's).
 */
export function dotRow(exercises: readonly Named[], order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>): DotRow {
  const groups: { key: string; name: string; dots: RowDot[] }[] = [];
  let done = 0;
  let skipped = 0;
  for (const ref of order) {
    if (isWarmup(ref)) continue;
    const state = stateOf(log.get(setKey(ref)));
    if (state === "open") continue;
    if (state === "done") done += 1;
    else skipped += 1;
    const name = nameOf(exercises, ref);
    let g = groups.at(-1);
    if (g === undefined || g.name !== name) {
      g = { key: setKey(ref), name, dots: [] };
      groups.push(g);
    }
    g.dots.push({ cx: 4 + 10 * g.dots.length, kind: state === "done" ? "done" : "skipped" });
  }
  return {
    groups: groups.map((g) => ({ key: g.key, width: 10 * g.dots.length - 2, dots: g.dots })),
    done,
    skipped,
    sentence: dotRowSentence(done, skipped),
  };
}

export function dotRowSentence(done: number, skipped: number): string {
  return `I dag: ${done} sæt udført, ${skipped} sprunget over.`;
}

/* ── §3.3 The session signature (finished view) ─────────────────────────────────────────── */

export const SIG_WIDTH = 360;
export const SIG_BASELINE = 116;
const BAR_MAX = 96; // units; BAR_MIN + 88 at the session's max
const BAR_MIN = 8;
const GAP_CAP_S = 360;

export type SigMarker = "ring" | "dash" | "square" | null;
export type SigBar = {
  readonly x: number;
  readonly w: number;
  readonly h: number;
  readonly hollow: boolean; // kg not in the sheet yet: drawn by reps, a different unit (never 0 kg)
  readonly muted: boolean; // Lettere
  readonly marker: SigMarker;
};
export type SigStub = { readonly x: number; readonly w: number };
export type Signature = {
  readonly bars: readonly SigBar[];
  readonly stubs: readonly SigStub[];
  readonly sentence: string;
};

type SigExercise = Pick<FokusExercise, "name" | "row" | "repsText"> & { readonly kg?: number | null };

/** Reps for drawing: reps_done when present, else the prescribed reps (a range's midpoint); null = unreadable. */
export function drawingReps(e: SigExercise | undefined, logged: LoggedSet | undefined): number | null {
  if (logged?.repsDone != null && logged.repsDone > 0) return logged.repsDone;
  if (e === undefined || e.repsText === null) return null;
  const range = repsRange(e.repsText);
  if (range !== null) return (range.low + range.top) / 2;
  const n = Number(e.repsText.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const markerOf = (feel: number | null | undefined): SigMarker =>
  feel === -1 ? "ring" : feel === 0 ? "dash" : feel === 1 ? "square" : null;

const seconds = (a: string, b: string): number | null => {
  const d = (Date.parse(b) - Date.parse(a)) / 1000;
  return Number.isFinite(d) && d >= 0 ? d : null;
};

/**
 * The finished view's signature: walk the session in sheet order (warm-ups included). Each done
 * tap is preceded by a gap of 2 + 14 × min(Δ, 6 min) / 6 min units, Δ = time since the previous
 * done tap (unknown: 2); a done set then draws a 4-unit bar, a warm-up's done nothing; a skipped
 * set is a 2-unit gap and a 4-unit stub (drawn as a × across the baseline). x is scaled by min(360 / total, 2), left-aligned.
 * Height: reps × kg over the session's max where the sheet has kg for the row (solid), else reps
 * over the max reps (hollow).
 */
export function signature(exercises: readonly SigExercise[], order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>): Signature {
  type Item = { kind: "bar"; gap: number; reps: number | null; kg: number | null; feel: number | null } | { kind: "stub"; gap: number } | { kind: "warm"; gap: number };
  const items: Item[] = [];
  let previousEnd: string | null = null;
  let feelCounts = { lighter: 0, expected: 0, harder: 0, none: 0 };
  for (const ref of order) {
    const logged = log.get(setKey(ref));
    const state = stateOf(logged);
    if (state === "open") continue;
    if (state === "skipped") {
      if (!isWarmup(ref)) items.push({ kind: "stub", gap: 2 });
      continue;
    }
    const end = logged?.endedAt ?? null;
    const delta = previousEnd !== null && end !== null ? seconds(previousEnd, end) : null;
    const gap = delta === null ? 2 : 2 + (14 * Math.min(delta, GAP_CAP_S)) / GAP_CAP_S;
    if (end !== null) previousEnd = end;
    if (isWarmup(ref)) {
      items.push({ kind: "warm", gap });
      continue;
    }
    const e = exercises.find((x) => x.row === ref.row);
    const kg = e?.kg != null && e.kg > 0 ? e.kg : null;
    const feel = logged?.feltRpe ?? null;
    if (feel === -1) feelCounts = { ...feelCounts, lighter: feelCounts.lighter + 1 };
    else if (feel === 0) feelCounts = { ...feelCounts, expected: feelCounts.expected + 1 };
    else if (feel === 1) feelCounts = { ...feelCounts, harder: feelCounts.harder + 1 };
    else feelCounts = { ...feelCounts, none: feelCounts.none + 1 };
    items.push({ kind: "bar", gap, reps: drawingReps(e, logged), kg, feel });
  }
  const total = items.reduce((sum, it) => sum + it.gap + (it.kind === "warm" ? 0 : 4), 0);
  const s = total === 0 ? 1 : Math.min(SIG_WIDTH / total, 2);
  const barItems = items.filter((it) => it.kind === "bar");
  const maxLoad = Math.max(0, ...barItems.map((b) => (b.kg !== null && b.reps !== null ? b.reps * b.kg : 0)));
  const maxReps = Math.max(0, ...barItems.map((b) => b.reps ?? 0));
  const bars: SigBar[] = [];
  const stubs: SigStub[] = [];
  let x = 0;
  let kgKnown = 0;
  for (const it of items) {
    x += it.gap * s;
    if (it.kind === "warm") continue;
    if (it.kind === "stub") {
      stubs.push({ x: round(x), w: round(4 * s) });
    } else {
      const load = it.kg !== null && it.reps !== null ? it.reps * it.kg : null;
      const solid = load !== null && maxLoad > 0;
      if (solid) kgKnown += 1;
      const ratio = solid ? load / maxLoad : it.reps !== null && maxReps > 0 ? it.reps / maxReps : 0;
      bars.push({ x: round(x), w: round(4 * s), h: round(BAR_MIN + (BAR_MAX - BAR_MIN) * ratio), hollow: !solid, muted: it.feel === -1, marker: markerOf(it.feel) });
    }
    x += 4 * s;
  }
  return {
    bars,
    stubs,
    sentence: signatureSentence(bars.length, stubs.length, kgKnown, feelCounts),
  };
}

const round = (v: number): number => Math.round(v * 100) / 100;

/**
 * The legend's kg line ("Hul søjle: … Husk at logge den.") shows only when a bar is hollow. Every
 * done set draws a bar and every bar without sheet kg is hollow, so no hollow bar = no kg to log.
 */
export function showsKgReminder(sig: Signature): boolean {
  return sig.bars.some((b) => b.hollow);
}

export function signatureSentence(
  done: number,
  skipped: number,
  kgKnown: number,
  feel: { readonly lighter: number; readonly expected: number; readonly harder: number; readonly none: number },
): string {
  return (
    `Sessionens forløb, et sæt pr. søjle: ${done} udført, ${skipped} sprunget over. ` +
    `Kg kendt for ${kgKnown} sæt; resten er tegnet efter reps. ` +
    `${feel.lighter} lettere, ${feel.expected} som ventet, ${feel.harder} hårdere, ${feel.none} uden vurdering.`
  );
}
