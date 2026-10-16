/**
 * Set timing taps (public.exercise_set_log, decided with the user 2026-10-12): the shape the
 * server action accepts, the order of a session's sets, and the optimistic mirror of the
 * server's rules for the screens. Pure: no React, no I/O.
 *
 * Rules (the server applies them at its own clock T; the client never sends a time). "Next
 * open set" = the first set after k in the sheet's order that is neither done nor skipped.
 *   begin  set k   -> k.started_at = T if null ("Begynd træning", the first open set)
 *   done   set k   -> k.ended_at = T if null, k.started_at = T if null, and the next open set's
 *                     started_at = T if null: a set's span includes the rest before it (the HR
 *                     stream is split by these later). A skipped k is un-skipped first.
 *   skip   set k   -> k skipped, no timestamps; the next open set's started_at = T if null.
 *                     Refused on a done set (undo its done first: its end would be lost).
 *   undo   set k   -> clears what k's last tap wrote: a done's end, and every start that holds
 *                     the same T on a set that isn't done; a skip (k's start comes back from the
 *                     previous set's end or skip time), and the starts it wrote; or a begin.
 * The order of sets is the sheet's: rows by sheet row, sets 1..n. The server derives next and
 * previous from strength_sets itself; the client only names the set it means.
 * Warm-ups (2026-10-13, spec fokus-pause.md): set 0 on the first row of each exercise run (rows
 * in a row with the same exercise) comes before its set 1, so the same rules apply: begin starts
 * the first warm-up, the done that finishes an exercise starts the next one's warm-up, and a done
 * on the warm-up ("Til sæt 1") ends it and starts set 1. A warm-up whose set 1 is already done or
 * skipped (ticked on the overview) is passed over. Warm-ups never count as sets.
 *   feel   set k   -> k.felt_rpe = value (-1/0/+1, null clears); only on a done set
 *   reps   set k   -> k.reps_done = value; only on a done set with a range prescription (the done
 *                     tap itself writes the top of the range when reps_done is empty)
 * An undo of a done also clears the set's rating and reps done (the set is open again).
 * Python reads felt_rpe and reps_done; logging kg stays in the coach's sheet (the app never writes kg).
 */

export type SetRef = { readonly row: number; readonly set: number };
export type SetTapKind = "begin" | "done" | "skip" | "undo" | "feel" | "reps";
/** What an undo undoes, as the client saw the set: so a retry of a half-done undo only finishes it. */
export type Undoes = "done" | "skip" | "begin";

/** What the server action receives (validated again on the server). */
export type SetTapInput = {
  readonly kind: SetTapKind;
  readonly date: string; // YYYY-MM-DD, the screen's date (must be today on the server)
  readonly session: number; // the n-th strength session of the ISO week
  readonly row: number; // strength_sets.sheet_row
  readonly set: number; // strength_sets.set_no
  readonly undoes: Undoes | null; // set exactly for kind "undo"
  /** feel: -1 / 0 / +1, or null to clear; reps: the reps done; absent or null for the others. */
  readonly value?: number | null;
};

/** One set's logged state, as read back from the log (or optimistically applied). */
export type LoggedSet = SetRef & {
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly skipped: boolean;
  /** The time of the row's latest write; for a skipped set, the skip's time. */
  readonly updatedAt: string | null;
  /** How the set felt: -1 Lettere, 0 Som ventet, +1 Hårdere; null or absent = not rated. */
  readonly feltRpe?: number | null;
  /** Reps done on a range set; null or absent = none. */
  readonly repsDone?: number | null;
};

/** Set 0: the warm-up before set 1 of an exercise run. */
export function isWarmup(ref: SetRef): boolean {
  return ref.set === 0;
}

/** The same instant (the server returns "…+00:00", a tap is written as "…Z"). */
export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && Date.parse(a) === Date.parse(b);
}

export type SetState = "open" | "done" | "skipped";

export function setKey(ref: SetRef): string {
  return `${ref.row}#${ref.set}`;
}

export function stateOf(logged: LoggedSet | undefined): SetState {
  if (logged === undefined) return "open";
  if (logged.skipped) return "skipped";
  return logged.endedAt !== null ? "done" : "open";
}

/** The session's sets in the sheet's order: by row, then set. */
export function sessionOrder(sets: readonly SetRef[]): SetRef[] {
  const unique = new Map(sets.map((s) => [setKey(s), { row: s.row, set: s.set }]));
  return [...unique.values()].toSorted((a, b) => a.row - b.row || a.set - b.set);
}

/** A set with its exercise name and, when known, its variant (strength_sets.variant_id). */
export type RunSet = { readonly ref: SetRef; readonly name: string; readonly variantId?: number | null };

/**
 * The rows that start an exercise run: a row whose exercise (trimmed, case-insensitive name) or
 * variant differs from the row before it (as training-view's sameRun; null matches only null). A
 * caller that passes no variant gets the name-only runs it always had.
 */
export function runStartRows(sets: readonly RunSet[]): Set<number> {
  const keys = new Map<number, string>();
  for (const s of sets) if (!keys.has(s.ref.row)) keys.set(s.ref.row, `${s.name.trim().toLowerCase()}#${s.variantId ?? "ukendt"}`);
  const starts = new Set<number>();
  let previous: string | null = null;
  for (const row of [...keys.keys()].toSorted((a, b) => a - b)) {
    const key = keys.get(row) ?? "";
    if (key !== previous) starts.add(row);
    previous = key;
  }
  return starts;
}

/** A superset pair in force (lib/supersets.ts): the first sheet rows of two consecutive runs. */
export type PairRef = { readonly rowA: number; readonly rowB: number };

/**
 * The rows that get a warm-up (set 0): a row whose exercise name (trimmed, case-insensitive)
 * differs from the row before it. Name only, never the variant: Python's warm-up ramp
 * (planned_sets.py) is keyed the same way, and a variant row inside a run never got its own
 * warm-up (reviewer 2026-10-15: a variant split here would add a set 0 mid-session).
 */
export function warmupRows(sets: readonly RunSet[]): Set<number> {
  return runStartRows(sets.map((s) => ({ ref: s.ref, name: s.name })));
}

/**
 * The sheet's order with a warm-up (set 0) before set 1 of each warm-up row (warmupRows). A pair's
 * two runs (runStartRows: name and variant) interleave at A's place: their warm-ups first (A0 B0,
 * when each has one), then the working sets by position, A1 B1 A2 B2 ...; the longer run's extra
 * sets follow alone. Without pairs the order is the sheet's.
 */
export function sessionOrderWithWarmups(sets: readonly RunSet[], pairs: readonly PairRef[] = []): SetRef[] {
  const order = sessionOrder(sets.map((s) => s.ref));
  const warm = warmupRows(sets);
  const starts = runStartRows(sets);
  const flat = order.flatMap((ref) => (ref.set === 1 && warm.has(ref.row) ? [{ row: ref.row, set: 0 }, ref] : [ref]));
  if (pairs.length === 0) return flat;
  const runs: SetRef[][] = [];
  for (const ref of flat) {
    const last = runs.at(-1);
    if (last === undefined || (starts.has(ref.row) && last[0].row !== ref.row)) runs.push([ref]);
    else last.push(ref);
  }
  const out: SetRef[] = [];
  for (let i = 0; i < runs.length; i += 1) {
    const a = runs[i];
    const b = runs.at(i + 1);
    if (b === undefined || !pairs.some((p) => p.rowA === a[0].row && p.rowB === b[0].row)) {
      out.push(...a);
      continue;
    }
    out.push(...a.filter(isWarmup), ...b.filter(isWarmup));
    const aw = a.filter((r) => !isWarmup(r));
    const bw = b.filter((r) => !isWarmup(r));
    for (let k = 0; k < Math.max(aw.length, bw.length); k += 1) {
      if (k < aw.length) out.push(aw[k]);
      if (k < bw.length) out.push(bw[k]);
    }
    i += 1;
  }
  return out;
}

/** A warm-up whose set 1 is done or skipped is passed over (ticked on the overview). */
function current(ref: SetRef, log: ReadonlyMap<string, LoggedSet>): boolean {
  if (stateOf(log.get(setKey(ref))) !== "open") return false;
  return !isWarmup(ref) || stateOf(log.get(setKey({ row: ref.row, set: 1 }))) === "open";
}

export function neighbours(
  order: readonly SetRef[],
  target: SetRef,
): { previous: SetRef | null; next: SetRef | null } {
  const i = order.findIndex((s) => s.row === target.row && s.set === target.set);
  if (i === -1) return { previous: null, next: null };
  return { previous: i > 0 ? order[i - 1] : null, next: i + 1 < order.length ? order[i + 1] : null };
}

/** The first set after `target` in the sheet's order that is neither done nor skipped. */
export function nextOpen(order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>, target: SetRef): SetRef | null {
  const i = order.findIndex((s) => s.row === target.row && s.set === target.set);
  if (i === -1) return null;
  return order.slice(i + 1).find((s) => current(s, log)) ?? null;
}

/** When a set that follows `previous` started, by that set's tap: its end, or its skip time. */
export function startAfter(previous: LoggedSet | undefined): string | null {
  if (previous === undefined) return null;
  if (previous.skipped) return previous.updatedAt;
  return previous.endedAt;
}

/**
 * Whether `start` on `target` was written by another set's tap (a done's end or a skip's time):
 * then undoing target's begin keeps it. Only a begin's own time belongs to no other set.
 */
export function startFromAnotherTap(log: ReadonlyMap<string, LoggedSet>, target: SetRef, start: string): boolean {
  for (const l of log.values()) {
    if (l.row === target.row && l.set === target.set) continue;
    if (sameInstant(l.endedAt, start) || (l.skipped && sameInstant(l.updatedAt, start))) return true;
  }
  return false;
}

/** The first set that is neither done nor skipped; null when every set is. */
export function firstOpen(order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>): SetRef | null {
  return order.find((s) => current(s, log)) ?? null;
}

export type Progress = { readonly done: number; readonly skipped: number; readonly total: number };

export function progress(order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>): Progress {
  let done = 0;
  let skipped = 0;
  const sets = order.filter((s) => !isWarmup(s));
  for (const s of sets) {
    const state = stateOf(log.get(setKey(s)));
    if (state === "done") done += 1;
    if (state === "skipped") skipped += 1;
  }
  return { done, skipped, total: sets.length };
}

/** The session's latest done or skip (what Fortryd undoes): the set, the kind and its time. */
export type LastTap = { readonly ref: SetRef; readonly kind: "done" | "skip"; readonly at: string };

export function lastTap(log: ReadonlyMap<string, LoggedSet>): LastTap | null {
  let latest: LastTap | null = null;
  for (const l of log.values()) {
    const tap: LastTap | null =
      l.skipped && l.updatedAt !== null
        ? { ref: { row: l.row, set: l.set }, kind: "skip", at: l.updatedAt }
        : l.endedAt !== null
          ? { ref: { row: l.row, set: l.set }, kind: "done", at: l.endedAt }
          : null;
    if (tap !== null && (latest === null || Date.parse(tap.at) > Date.parse(latest.at))) latest = tap;
  }
  return latest;
}

/** When the rest timer counts from: the latest tap, if it was a done of a set (not "Til sæt 1"). */
export function restStart(log: ReadonlyMap<string, LoggedSet>): string | null {
  const last = lastTap(log);
  return last !== null && last.kind === "done" && !isWarmup(last.ref) ? last.at : null;
}

/** What an undo of `target` would undo now; null when there is nothing to undo. */
export function undoesOf(log: ReadonlyMap<string, LoggedSet>, target: SetRef): Undoes | null {
  const own = log.get(setKey(target));
  if (own === undefined) return null;
  if (own.skipped) return "skip";
  if (own.endedAt !== null) return "done";
  if (own.startedAt !== null && !startFromAnotherTap(log, target, own.startedAt)) return "begin";
  return null;
}

/** Whether the server would refuse the tap (the screens don't offer it). */
export function refused(log: ReadonlyMap<string, LoggedSet>, kind: SetTapKind, target: SetRef): boolean {
  const state = stateOf(log.get(setKey(target)));
  if (kind === "skip") return state === "done";
  if (kind === "feel" || kind === "reps") return state !== "done" || isWarmup(target);
  return false;
}

/** The top of a range prescription ("8 - 12" -> 12); null for fixed reps ("3") or none. */
export function rangeTop(repsText: string | null): number | null {
  // As Python's domain.set_feedback.range_top: whole or decimal ends, comma or dot.
  const m = repsText === null ? null : /^\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*$/.exec(repsText);
  if (m === null) return null;
  const end = (s: string | undefined) => Number((s ?? "").replace(",", "."));
  return Math.max(end(m[1]), end(m[2]));
}

/** Each set's range top (rangeTop of its row's reps), keyed by setKey; what a done stores as reps. */
export type RangeTops = ReadonlyMap<string, number | null>;

export function rangeTops(rows: Iterable<{ readonly repsText: string | null; readonly sets: readonly SetRef[] }>): RangeTops {
  const tops = new Map<string, number | null>();
  for (const r of rows) for (const s of r.sets) tops.set(setKey(s), rangeTop(r.repsText));
  return tops;
}

// ---------------------------------------------------------------- the one tap transition

/** The columns a tap writes (exercise_set_log: started_at, ended_at, skipped, felt_rpe, reps_done). */
export type LogValues = {
  readonly startedAt?: string | null;
  readonly endedAt?: string | null;
  readonly skipped?: boolean;
  readonly feltRpe?: number | null;
  readonly repsDone?: number | null;
};

/** A write's condition on one column: null = "is null", false = "is false", a time = that instant. */
export type Guard = { readonly field: "startedAt" | "endedAt" | "skipped" | "repsDone"; readonly equals: string | boolean | null };

/**
 * One write of a tap, in the order the server sends them (each is one request, conditional, so a
 * retry or a half-landed tap is safe):
 *  ensure      create the set's row with `values` if it has none; never overwrite one
 *  patch       set `values` on the set's row where every guard holds (updatedAt null: leave it)
 *  clearStarts every set in the session with started_at = t and no end: started_at = null
 *  deleteEmpty delete the session's rows with no start, no end and not skipped
 */
export type Change =
  | { readonly op: "ensure"; readonly ref: SetRef; readonly values: LogValues; readonly updatedAt: string }
  | { readonly op: "patch"; readonly ref: SetRef; readonly when: readonly Guard[]; readonly values: LogValues; readonly updatedAt: string | null }
  | { readonly op: "clearStarts"; readonly t: string; readonly at: string }
  | { readonly op: "deleteEmpty" };

/** A tap as the transition reads it (the server action's input without date and session). */
export type Tap = { readonly kind: SetTapKind; readonly target: SetRef; readonly undoes: Undoes | null; readonly value: number | null };

/** Sets `fields` to `at` where they are null (first write wins), unless the set is skipped. */
function setIfNull(ref: SetRef, fields: readonly ("startedAt" | "endedAt")[], at: string): Change[] {
  return [
    { op: "ensure", ref, values: Object.fromEntries(fields.map((f) => [f, at])), updatedAt: at },
    ...fields.map((field): Change => ({
      op: "patch",
      ref,
      when: [{ field, equals: null }, { field: "skipped", equals: false }],
      values: { [field]: at },
      updatedAt: at,
    })),
  ];
}

/**
 * The tap rules (module comment) as the writes they make, at the server's time `at`, against
 * the session's log as read before the tap. null: the tap is refused (skip of a done set, feel or
 * reps on a set that isn't done, reps outside 1 .. top + 10 or on a set without a range). The
 * server sends each Change as one request (lib/db/set-log.ts); the client applies them to its log
 * (applyChanges), so both follow one copy of the rules.
 */
export function transition(order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>, tap: Tap, at: string, tops: RangeTops): Change[] | null {
  const { kind, target } = tap;
  if (refused(log, kind, target)) return null;
  const logged = log.get(setKey(target));
  const after = nextOpen(order, log, target); // null: no open set after it
  const top = tops.get(setKey(target)) ?? null;
  switch (kind) {
    case "begin":
      return stateOf(logged) === "open" ? setIfNull(target, ["startedAt"], at) : [];
    case "done": {
      // A retry of a done that already landed (partly) finishes it with the tap's own time, so
      // one tap keeps one T everywhere (undo finds it) and the next set still gets its start.
      const t = stateOf(logged) === "done" && logged?.endedAt != null ? logged.endedAt : at;
      const out: Change[] = [];
      if (logged?.skipped === true) out.push({ op: "patch", ref: target, when: [], values: { skipped: false }, updatedAt: at });
      if (top !== null && logged?.repsDone == null) {
        // A range set: its reps default to the top (the stepper adjusts it).
        out.push({ op: "ensure", ref: target, values: { repsDone: top }, updatedAt: t });
        out.push({ op: "patch", ref: target, when: [{ field: "repsDone", equals: null }], values: { repsDone: top }, updatedAt: null });
      }
      out.push(...setIfNull(target, ["startedAt", "endedAt"], t));
      if (after !== null) out.push(...setIfNull(after, ["startedAt"], t));
      return out;
    }
    case "skip": {
      // As done: a retry reuses the skip's own time (its updated_at) for the next set's start.
      const t = logged?.skipped === true && logged.updatedAt !== null ? logged.updatedAt : at;
      const out: Change[] = [];
      if (logged?.skipped !== true) {
        out.push({ op: "ensure", ref: target, values: { skipped: true }, updatedAt: t });
        out.push({ op: "patch", ref: target, when: [], values: { skipped: true, startedAt: null, endedAt: null }, updatedAt: t });
      }
      if (after !== null) out.push(...setIfNull(after, ["startedAt"], t));
      return out;
    }
    case "feel":
      // One column on a done set: -1 / 0 / +1, or null to clear.
      return [{ op: "patch", ref: target, when: [], values: { feltRpe: tap.value ?? null }, updatedAt: at }];
    case "reps": {
      // A range set only, within 1 .. top + 10 (spec fokus-pause.md).
      const reps = tap.value ?? null;
      if (top === null || reps === null || reps < 1 || reps > top + 10) return null;
      return [{ op: "patch", ref: target, when: [], values: { repsDone: reps }, updatedAt: at }];
    }
    case "undo": {
      // Applied only while the set is still what the client undid (tap.undoes); otherwise this is
      // a retry of an undo that already landed, and only the cleanup is left. The tap's own mark
      // (the set's end, or its skip) is cleared last, so a partial undo is finished by its retry.
      const state = logged === undefined ? null : logged.skipped ? "skip" : logged.endedAt !== null ? "done" : "begin";
      const out: Change[] = [];
      if (logged !== undefined && tap.undoes === "skip" && state === "skip") {
        const { previous } = neighbours(order, target);
        const previousLogged = previous === null ? undefined : log.get(setKey(previous));
        out.push({ op: "clearStarts", t: logged.updatedAt ?? at, at }); // the starts the skip wrote
        out.push({ op: "patch", ref: target, when: [], values: { skipped: false, startedAt: startAfter(previousLogged) }, updatedAt: at });
      } else if (logged?.endedAt != null && tap.undoes === "done" && state === "done") {
        const t = logged.endedAt;
        out.push({ op: "clearStarts", t, at }); // on sets that aren't done
        out.push({ op: "patch", ref: target, when: [{ field: "startedAt", equals: t }, { field: "endedAt", equals: t }], values: { startedAt: null }, updatedAt: at });
        // The set is open again: its rating and reps done go with its end (one request).
        out.push({ op: "patch", ref: target, when: [{ field: "endedAt", equals: t }], values: { endedAt: null, feltRpe: null, repsDone: null }, updatedAt: at });
      } else if (
        logged?.startedAt != null &&
        tap.undoes === "begin" &&
        state === "begin" &&
        !startFromAnotherTap(log, target, logged.startedAt)
      ) {
        out.push({ op: "clearStarts", t: logged.startedAt, at }); // a begin
      }
      out.push({ op: "deleteEmpty" });
      return out;
    }
  }
}

function holds(row: LoggedSet, guard: Guard): boolean {
  const value = row[guard.field] ?? null;
  if (guard.equals === null) return value === null;
  if (typeof guard.equals === "boolean") return value === guard.equals;
  return typeof value === "string" && sameInstant(value, guard.equals);
}

/** The Changes applied to a log, as the table applies their requests. Returns a new map. */
export function applyChanges(log: ReadonlyMap<string, LoggedSet>, changes: readonly Change[]): Map<string, LoggedSet> {
  const next = new Map(log);
  for (const c of changes) {
    if (c.op === "ensure") {
      const k = setKey(c.ref);
      if (!next.has(k)) next.set(k, { row: c.ref.row, set: c.ref.set, startedAt: null, endedAt: null, skipped: false, feltRpe: null, repsDone: null, ...c.values, updatedAt: c.updatedAt });
    } else if (c.op === "patch") {
      const k = setKey(c.ref);
      const row = next.get(k);
      if (row !== undefined && c.when.every((g) => holds(row, g))) next.set(k, { ...row, ...c.values, ...(c.updatedAt === null ? {} : { updatedAt: c.updatedAt }) });
    } else if (c.op === "clearStarts") {
      for (const [k, row] of next) if (row.endedAt === null && sameInstant(row.startedAt, c.t)) next.set(k, { ...row, startedAt: null, updatedAt: c.at });
    } else {
      for (const [k, row] of next) if (row.startedAt === null && row.endedAt === null && !row.skipped) next.delete(k);
    }
  }
  return next;
}

/**
 * The server's rules applied locally at `at`, for an instant screen (the server's own write is
 * the truth; the page re-reads it): transition's Changes applied to the log. An undo undoes what
 * undoesOf reads (as useSetLog sends). `tops`: the range tops (rangeTops), so a done stores the
 * top as reps done as the server does. Returns a new map; `log` is not changed.
 */
export function applyTap(
  order: readonly SetRef[],
  log: ReadonlyMap<string, LoggedSet>,
  kind: SetTapKind,
  target: SetRef,
  at: string,
  value: number | null = null,
  tops: RangeTops = new Map(),
): Map<string, LoggedSet> {
  const undoes = kind === "undo" ? (undoesOf(log, target) ?? "done") : null;
  const changes = transition(order, log, { kind, target, undoes, value }, at, tops);
  return changes === null ? new Map(log) : applyChanges(log, changes);
}

const KINDS: readonly SetTapKind[] = ["begin", "done", "skip", "undo", "feel", "reps"];
const UNDOES: readonly Undoes[] = ["done", "skip", "begin"];
export const MAX_SESSION = 14; // the sheet never plans more; anything above is not a session
const MAX_ROW = 10_000;
const MAX_SET = 100;

function whole(value: unknown, max: number, min = 1): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

const MAX_REPS = 100;

/** A feel or reps tap's value; null for the other kinds (and to clear a feel). undefined: invalid. */
function tapValue(kind: SetTapKind, raw: unknown): number | null | undefined {
  if (kind === "feel") return raw === null ? null : raw === -1 || raw === 0 || raw === 1 ? raw : undefined;
  if (kind === "reps") return whole(raw, MAX_REPS) ?? undefined;
  return raw === undefined || raw === null ? null : undefined;
}

/** The action's input from an untrusted client: exact shape or null (the server checks more). */
export function parseSetTapInput(raw: unknown): SetTapInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>; // narrowed field by field below
  const kind = KINDS.find((k) => k === r.kind);
  const session = whole(r.session, MAX_SESSION);
  const row = whole(r.row, MAX_ROW);
  const set = whole(r.set, MAX_SET, 0); // 0: an exercise's warm-up
  const undoes = UNDOES.find((u) => u === r.undoes) ?? null;
  const value = kind === undefined ? undefined : tapValue(kind, r.value);
  if (
    kind === undefined ||
    value === undefined ||
    session === null ||
    row === null ||
    set === null ||
    typeof r.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
    (kind === "undo" ? undoes === null : r.undoes !== null)
  ) {
    return null;
  }
  return { kind, date: r.date, session, row, set, undoes, value };
}
