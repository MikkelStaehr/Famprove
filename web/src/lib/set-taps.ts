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
 * Nothing computes from the log. Logging kg stays in the coach's sheet; the app never writes kg.
 */

export type SetRef = { readonly row: number; readonly set: number };
export type SetTapKind = "begin" | "done" | "skip" | "undo";

/** What the server action receives (validated again on the server). */
export type SetTapInput = {
  readonly kind: SetTapKind;
  readonly date: string; // YYYY-MM-DD, the screen's date (must be today on the server)
  readonly session: number; // the n-th strength session of the ISO week
  readonly row: number; // strength_sets.sheet_row
  readonly set: number; // strength_sets.set_no
};

/** One set's logged state, as read back from the log (or optimistically applied). */
export type LoggedSet = SetRef & {
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly skipped: boolean;
  /** The time of the row's latest write; for a skipped set, the skip's time. */
  readonly updatedAt: string | null;
};

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
  return order.slice(i + 1).find((s) => stateOf(log.get(setKey(s))) === "open") ?? null;
}

/** When a set that follows `previous` started, by that set's tap: its end, or its skip time. */
export function startAfter(previous: LoggedSet | undefined): string | null {
  if (previous === undefined) return null;
  if (previous.skipped) return previous.updatedAt;
  return previous.endedAt;
}

/** The first set that is neither done nor skipped; null when every set is. */
export function firstOpen(order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>): SetRef | null {
  return order.find((s) => stateOf(log.get(setKey(s))) === "open") ?? null;
}

export type Progress = { readonly done: number; readonly skipped: number; readonly total: number };

export function progress(order: readonly SetRef[], log: ReadonlyMap<string, LoggedSet>): Progress {
  let done = 0;
  let skipped = 0;
  for (const s of order) {
    const state = stateOf(log.get(setKey(s)));
    if (state === "done") done += 1;
    if (state === "skipped") skipped += 1;
  }
  return { done, skipped, total: order.length };
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

/** When the rest timer counts from: the latest tap, if it was a done; else null. */
export function restStart(log: ReadonlyMap<string, LoggedSet>): string | null {
  const last = lastTap(log);
  return last !== null && last.kind === "done" ? last.at : null;
}

/** Whether the server would refuse the tap (the screens don't offer it). */
export function refused(log: ReadonlyMap<string, LoggedSet>, kind: SetTapKind, target: SetRef): boolean {
  return kind === "skip" && stateOf(log.get(setKey(target))) === "done";
}

function put(log: Map<string, LoggedSet>, ref: SetRef, change: Partial<LoggedSet>, at: string): void {
  const before = log.get(setKey(ref)) ?? { ...ref, startedAt: null, endedAt: null, skipped: false, updatedAt: null };
  const after = { ...before, ...change, updatedAt: at };
  if (after.startedAt === null && after.endedAt === null && !after.skipped) log.delete(setKey(ref));
  else log.set(setKey(ref), after);
}

/** Clears every start that holds `t` on a set that isn't done (what one tap wrote). */
function clearStarts(log: Map<string, LoggedSet>, t: string, at: string): void {
  for (const l of [...log.values()]) {
    if (l.endedAt === null && sameInstant(l.startedAt, t)) put(log, l, { startedAt: null }, at);
  }
}

/**
 * The server's rules applied locally at `at`, for an instant screen (the server's own write is
 * the truth; the page re-reads it). Returns a new map; `log` is not changed.
 */
export function applyTap(
  order: readonly SetRef[],
  log: ReadonlyMap<string, LoggedSet>,
  kind: SetTapKind,
  target: SetRef,
  at: string,
): Map<string, LoggedSet> {
  const next = new Map(log);
  if (refused(log, kind, target)) return next;
  const own = log.get(setKey(target));
  const following = nextOpen(order, log, target);
  switch (kind) {
    case "begin":
      if (stateOf(own) === "open" && own?.startedAt == null) put(next, target, { startedAt: at }, at);
      break;
    case "done":
      if (stateOf(own) === "done") break;
      put(next, target, { skipped: false, startedAt: own?.startedAt ?? at, endedAt: at }, at);
      if (following !== null && log.get(setKey(following))?.startedAt == null) put(next, following, { startedAt: at }, at);
      break;
    case "skip":
      put(next, target, { skipped: true, startedAt: null, endedAt: null }, at);
      if (following !== null && log.get(setKey(following))?.startedAt == null) put(next, following, { startedAt: at }, at);
      break;
    case "undo": {
      if (own === undefined) break;
      const { previous } = neighbours(order, target);
      if (own.skipped) {
        const t = own.updatedAt;
        put(next, target, { skipped: false, startedAt: startAfter(previous === null ? undefined : log.get(setKey(previous))) }, at);
        if (t !== null) clearStarts(next, t, at);
      } else if (own.endedAt !== null) {
        const t = own.endedAt;
        put(next, target, { endedAt: null }, at);
        clearStarts(next, t, at);
      } else if (own.startedAt !== null) {
        const prev = previous === null ? undefined : log.get(setKey(previous));
        if (!sameInstant(startAfter(prev), own.startedAt)) put(next, target, { startedAt: null }, at);
      }
      break;
    }
  }
  return next;
}

const KINDS: readonly SetTapKind[] = ["begin", "done", "skip", "undo"];
export const MAX_SESSION = 14; // the sheet never plans more; anything above is not a session
const MAX_ROW = 10_000;
const MAX_SET = 100;

function whole(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max ? value : null;
}

/** The action's input from an untrusted client: exact shape or null (the server checks more). */
export function parseSetTapInput(raw: unknown): SetTapInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>; // narrowed field by field below
  const kind = KINDS.find((k) => k === r.kind);
  const session = whole(r.session, MAX_SESSION);
  const row = whole(r.row, MAX_ROW);
  const set = whole(r.set, MAX_SET);
  if (
    kind === undefined ||
    session === null ||
    row === null ||
    set === null ||
    typeof r.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(r.date)
  ) {
    return null;
  }
  return { kind, date: r.date, session, row, set };
}
