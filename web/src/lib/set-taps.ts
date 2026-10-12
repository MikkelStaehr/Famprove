/**
 * Set timing taps (public.exercise_set_log, decided with the user 2026-10-12): the shape the
 * server action accepts, the order of a session's sets, and the optimistic mirror of the
 * server's rules for the screens. Pure: no React, no I/O.
 *
 * Rules (the server applies them at its own clock T; the client never sends a time):
 *   begin  set k                -> k.started_at = T if null ("Begynd træning", the first open set)
 *   done   set k                -> k.ended_at = T if null, k.started_at = T if null, and the next
 *                                  set's started_at = T if null: a set's span includes the rest
 *                                  before it (the HR stream is split by these later)
 *   skip   set k                -> k skipped, no timestamps; the next set's started_at = T if null
 *   undo   set k                -> clears what k's tap wrote: a done set's end (and its start and
 *                                  the next set's start where they hold the same T), a skip (and
 *                                  the next set's start it set; k's start comes back from the
 *                                  previous set's end), or a begin
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
};

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

export function neighbours(order: readonly SetRef[], target: SetRef): { previous: SetRef | null; next: SetRef | null } {
  const i = order.findIndex((s) => s.row === target.row && s.set === target.set);
  if (i === -1) return { previous: null, next: null };
  return { previous: i > 0 ? order[i - 1] : null, next: i + 1 < order.length ? order[i + 1] : null };
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

/** When the rest timer counts from: the latest end of a done set; null before the first. */
export function restStart(log: ReadonlyMap<string, LoggedSet>): string | null {
  let latest: string | null = null;
  for (const l of log.values()) {
    if (l.endedAt !== null && !l.skipped && (latest === null || Date.parse(l.endedAt) > Date.parse(latest))) {
      latest = l.endedAt;
    }
  }
  return latest;
}

function put(log: Map<string, LoggedSet>, ref: SetRef, change: Partial<LoggedSet>): void {
  const before = log.get(setKey(ref)) ?? { ...ref, startedAt: null, endedAt: null, skipped: false };
  const after = { ...before, ...change };
  if (after.startedAt === null && after.endedAt === null && !after.skipped) log.delete(setKey(ref));
  else log.set(setKey(ref), after);
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
  const { previous, next: following } = neighbours(order, target);
  const own = log.get(setKey(target));
  switch (kind) {
    case "begin":
      if (own?.startedAt == null && !own?.skipped) put(next, target, { startedAt: at });
      break;
    case "done":
      put(next, target, { skipped: false, startedAt: own?.startedAt ?? at, endedAt: own?.endedAt ?? at });
      if (following !== null && log.get(setKey(following))?.startedAt == null) put(next, following, { startedAt: at });
      break;
    case "skip":
      put(next, target, { skipped: true, startedAt: null, endedAt: null });
      if (following !== null && log.get(setKey(following))?.startedAt == null) put(next, following, { startedAt: at });
      break;
    case "undo": {
      if (own === undefined) break;
      if (own.skipped) {
        const restored = previous === null ? null : (log.get(setKey(previous))?.endedAt ?? null);
        put(next, target, { skipped: false, startedAt: restored });
        // The skip's time isn't kept locally: an open next set's start goes (the server compares).
        const f = following === null ? undefined : log.get(setKey(following));
        if (following !== null && f !== undefined && f.endedAt === null) put(next, following, { startedAt: null });
      } else if (own.endedAt !== null) {
        const t = own.endedAt;
        put(next, target, { endedAt: null, startedAt: own.startedAt === t ? null : own.startedAt });
        const f = following === null ? undefined : log.get(setKey(following));
        if (following !== null && f?.startedAt === t) put(next, following, { startedAt: null });
      } else if (own.startedAt !== null) {
        const prevEnd = previous === null ? null : (log.get(setKey(previous))?.endedAt ?? null);
        if (prevEnd !== own.startedAt) put(next, target, { startedAt: null });
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
