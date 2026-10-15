/**
 * Supersets (user, 2026-10-15, slice supersets; public.superset_pairs): two consecutive exercise
 * runs of a session done as A1, B1, rest, A2, B2 ... A run is what the warm-up rule calls one
 * (lib/set-taps.ts runStartRows: consecutive rows with the same exercise and variant), keyed by
 * its first sheet row. Pure: no React, no I/O. The server (lib/db/set-log.ts, lib/db/superset-pairs.ts)
 * and the screens (training-view.ts) use the same rules, so client and server order agree.
 *
 * Which pairs are in force (effectivePairs), per consecutive (A, B) in sheet order:
 *  1. today's row for row_a, whose row_b is still B's first row, decides (paired true or false);
 *  2. otherwise the latest earlier row for the same ordered (exercise_a, variant_a, exercise_b,
 *     variant_b) (null variant matches only null): paired true makes it a suggestion in force;
 *  3. otherwise not paired.
 * A run is in at most one pair: walking in sheet order, the first pair wins.
 */

import { type LoggedSet, type PairRef, runStartRows, type RunSet, type SetRef } from "./set-taps.ts";

/** One run of a session: its first sheet row, its exercise (public.exercises id; null = unknown name), variant and rows. */
export type SessionRun = {
  readonly row: number;
  readonly exerciseId: number | null;
  readonly variantId: number | null;
  readonly rows: readonly number[];
  readonly sets: number; // working sets (warm-ups are not sets)
};

/** A public.superset_pairs row as the rules need it (rows.ts SupersetPairRow has this shape). */
export type PairDecision = {
  readonly date: string;
  readonly session: number;
  readonly rowA: number;
  readonly rowB: number;
  readonly exerciseA: number;
  readonly variantA: number | null;
  readonly exerciseB: number;
  readonly variantB: number | null;
  readonly paired: boolean;
  readonly updatedAt: string;
};

export type PairSource = "today" | "suggested";
export type EffectivePair = PairRef & { readonly source: PairSource };

function nameKey(name: string): string {
  return name.trim().toLowerCase(); // as public.exercises' lower(btrim(name))
}

/** public.exercises id per name and alias key; a canonical name wins over another's alias. */
export function exerciseIdMap(
  rows: readonly { readonly id: number; readonly name: string; readonly aliases: readonly string[] }[],
): Map<string, number> {
  const ids = new Map<string, number>();
  for (const e of rows) if (!ids.has(nameKey(e.name))) ids.set(nameKey(e.name), e.id);
  for (const e of rows) for (const a of e.aliases) if (!ids.has(nameKey(a))) ids.set(nameKey(a), e.id);
  return ids;
}

export function exerciseIdOf(ids: ReadonlyMap<string, number>, name: string): number | null {
  return ids.get(nameKey(name)) ?? null;
}

/** The session's runs in sheet order (set 0 is never in `sets`: warm-ups come from the order). */
export function sessionRuns(sets: readonly RunSet[], ids: ReadonlyMap<string, number>): SessionRun[] {
  const starts = runStartRows(sets);
  const byRow = new Map<number, { name: string; variantId: number | null; sets: number }>();
  for (const s of sets) {
    if (s.ref.set === 0) continue;
    const r = byRow.get(s.ref.row);
    if (r === undefined) byRow.set(s.ref.row, { name: s.name, variantId: s.variantId ?? null, sets: 1 });
    else r.sets += 1;
  }
  const runs: { row: number; exerciseId: number | null; variantId: number | null; rows: number[]; sets: number }[] = [];
  for (const row of [...byRow.keys()].toSorted((a, b) => a - b)) {
    const r = byRow.get(row);
    if (r === undefined) continue;
    const last = runs.at(-1);
    if (last === undefined || starts.has(row)) {
      runs.push({ row, exerciseId: exerciseIdOf(ids, r.name), variantId: r.variantId, rows: [row], sets: r.sets });
    } else {
      last.rows.push(row);
      last.sets += r.sets;
    }
  }
  return runs;
}

function sameRunPair(d: PairDecision, a: SessionRun, b: SessionRun): boolean {
  return d.exerciseA === a.exerciseId && d.variantA === a.variantId && d.exerciseB === b.exerciseId && d.variantB === b.variantId;
}

/** The latest of `rows` by date, then updated_at (the last write of a day wins). */
function latest(rows: readonly PairDecision[]): PairDecision | null {
  let best: PairDecision | null = null;
  for (const r of rows) {
    if (best === null || r.date > best.date || (r.date === best.date && Date.parse(r.updatedAt) > Date.parse(best.updatedAt))) best = r;
  }
  return best;
}

/**
 * The pairs in force for a session: `todayRows` = today's rows of this session, `history` = rows
 * of earlier days (any session). See the module comment for the rules.
 */
export function effectivePairs(
  runs: readonly SessionRun[],
  todayRows: readonly PairDecision[],
  history: readonly PairDecision[],
): EffectivePair[] {
  const out: EffectivePair[] = [];
  const used = new Set<number>();
  for (let i = 0; i + 1 < runs.length; i += 1) {
    const a = runs[i];
    const b = runs[i + 1];
    if (used.has(a.row) || a.exerciseId === null || b.exerciseId === null) continue;
    const today = todayRows.find((r) => r.rowA === a.row && r.rowB === b.row); // a stale row_b is ignored
    let source: PairSource | null = null;
    if (today !== undefined) source = today.paired ? "today" : null;
    else if (latest(history.filter((r) => sameRunPair(r, a, b)))?.paired === true) source = "suggested";
    if (source === null) continue;
    out.push({ rowA: a.row, rowB: b.row, source });
    used.add(a.row);
    used.add(b.row);
  }
  return out;
}

/**
 * Whether a pair (or a would-be pair) of runs can no longer be switched: either run has a logged
 * set, except A's warm-up (set 0 of A's first row; "Begynd træning" may have started it).
 */
export function pairLocked(a: SessionRun, b: SessionRun, log: Iterable<SetRef | LoggedSet>): boolean {
  for (const l of log) {
    if (l.row === a.row && l.set === 0) continue;
    if (a.rows.includes(l.row) || b.rows.includes(l.row)) return true;
  }
  return false;
}

/** A boundary between two consecutive runs, for the screens' ⇄ switch. */
export type PairSlot = {
  readonly rowA: number;
  readonly rowB: number;
  readonly paired: boolean;
  readonly source: PairSource | null; // null when not paired
  /** The switch is off: a set of either run is logged (except A's warm-up), or pairing would put a run in a second pair. */
  readonly locked: boolean;
};

export function pairSlots(runs: readonly SessionRun[], pairs: readonly EffectivePair[], log: Iterable<SetRef | LoggedSet>): PairSlot[] {
  const logged = [...log];
  const inPair = new Set(pairs.flatMap((p) => [p.rowA, p.rowB]));
  const slots: PairSlot[] = [];
  for (let i = 0; i + 1 < runs.length; i += 1) {
    const a = runs[i];
    const b = runs[i + 1];
    if (a.exerciseId === null || b.exerciseId === null) continue;
    const pair = pairs.find((p) => p.rowA === a.row && p.rowB === b.row) ?? null;
    const taken = pair === null && (inPair.has(a.row) || inPair.has(b.row));
    slots.push({ rowA: a.row, rowB: b.row, paired: pair !== null, source: pair?.source ?? null, locked: taken || pairLocked(a, b, logged) });
  }
  return slots;
}

/** What the server action receives (validated again on the server). */
export type SupersetInput = {
  readonly date: string;
  readonly sessionNo: number;
  readonly rowA: number;
  readonly rowB: number;
  readonly paired: boolean;
};

export type SupersetRefusal = "dev" | "invalid" | "not_today" | "no_session" | "not_consecutive" | "started" | "overlap" | "failed";
export type SupersetResult =
  | { readonly ok: true; readonly pairs: readonly EffectivePair[] }
  | { readonly ok: false; readonly reason: SupersetRefusal };

const MAX_SESSION = 14;
const MAX_ROW = 10_000;

function whole(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

/** The action's input from an untrusted client: exact shape or null. */
export function parseSupersetInput(raw: unknown): SupersetInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>; // narrowed field by field below
  const sessionNo = whole(r.sessionNo, MAX_SESSION);
  const rowA = whole(r.rowA, MAX_ROW);
  const rowB = whole(r.rowB, MAX_ROW);
  if (
    typeof r.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
    sessionNo === null ||
    rowA === null ||
    rowB === null ||
    rowB <= rowA ||
    typeof r.paired !== "boolean"
  ) {
    return null;
  }
  return { date: r.date, sessionNo, rowA, rowB, paired: r.paired };
}
