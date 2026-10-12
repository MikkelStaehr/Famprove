/**
 * Exercise timing taps (public.exercise_log, decided with the user 2026-10-12): which tap a tick
 * on Today's sheet rows is, and the shape the server action accepts. Pure: no React, no I/O.
 *
 * An exercise is every row of the session with the same name (trimmed, case-insensitive, as
 * public.exercises matches names); it is done when its last row is ticked. Rules, in order:
 *   start       the first tick on any row of X                  -> X.started_at if null
 *   end         the tick that completes X                        -> X.started_at and X.ended_at if
 *                                                                   null, and the next exercise's
 *                                                                   started_at if null
 *   undo-end    unticking a row of a completed X                 -> clears what the end tap wrote
 *   undo-start  unticking X's only ticked row                     -> clears what the start tap wrote
 * Every field one tap writes holds that tap's server timestamp, and the server returns it only
 * when the tap wrote something (first write wins, so a re-tick after a reload writes nothing).
 * The client keeps it in memory, like the ticks, and an undo sends it back: the server clears
 * only fields that still hold exactly that value. The client never sends a time of its own.
 * Limit: an exercise split around another one (Squat, Bench, Squat) is one row; the one in the
 * middle then starts and ends inside it. No real session did that (checked 2026-10-12).
 * Nothing computes from the log: it is collected to split the Garmin HR stream of a strength
 * session per exercise later.
 */

export type TapKind = "start" | "end" | "undo-end" | "undo-start";

export type TapChange = {
  readonly kind: TapKind;
  readonly exercise: string; // the sheet name as written (trimmed)
  /** end / undo-end: the exercise of the first row after X's last row; null when X is last. */
  readonly next: string | null;
};

/** What the server action receives (validated again on the server by parseTapInput). */
export type TapInput = TapChange & {
  readonly date: string; // YYYY-MM-DD, the Today screen's date
  readonly session: number; // the n-th strength session of the ISO week
  /** undo-*: the timestamp the server returned for the tap being undone; null for start / end. */
  readonly at: string | null;
};

type Row = { readonly key: string; readonly name: string };

/** Trimmed, lower case: the same key public.exercises uses (lower(btrim(name))). */
export function exerciseKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The tap that ticking (`done`) or unticking row `rowKey` makes, given the rows in sheet order
 * and whether each row was ticked BEFORE this change; null when the change is not a tap
 * (a middle row of an exercise that is neither its first tick nor its completion).
 */
export function tapChange(
  rows: readonly Row[],
  tickedBefore: (rowKey: string) => boolean,
  rowKey: string,
  done: boolean,
): TapChange | null {
  const index = rows.findIndex((r) => r.key === rowKey);
  if (index === -1) return null;
  const key = exerciseKey(rows[index].name);
  const own = rows.flatMap((r, i) => (exerciseKey(r.name) === key ? [i] : []));
  const before = own.filter((i) => tickedBefore(rows[i].key)).length;
  const after = before + (done ? 1 : -1);
  const exercise = rows[index].name.trim();
  const last = own[own.length - 1];
  const next = last + 1 < rows.length ? rows[last + 1].name.trim() : null;
  if (done && after === own.length) return { kind: "end", exercise, next };
  if (done && before === 0) return { kind: "start", exercise, next: null };
  if (!done && before === own.length) return { kind: "undo-end", exercise, next };
  if (!done && after === 0) return { kind: "undo-start", exercise, next: null };
  return null;
}

const KINDS: readonly TapKind[] = ["start", "end", "undo-end", "undo-start"];
export const MAX_SESSION = 14; // the sheet never plans more; anything above is not a session
const MAX_NAME = 200;

/** An ISO timestamp as the server returns or writes it, e.g. 2026-10-12T08:05:00.123+00:00. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function name(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_NAME ? trimmed : null;
}

/**
 * The action's input from an untrusted client: exact shape or null. It checks the shape only;
 * the server checks the date is today and the names are in that session of the sheet.
 */
export function parseTapInput(raw: unknown): TapInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>; // narrowed field by field below
  const kind = KINDS.find((k) => k === r.kind);
  const exercise = name(r.exercise);
  const next = r.next === null ? null : name(r.next);
  const undo = kind === "undo-end" || kind === "undo-start";
  const at = typeof r.at === "string" && TIMESTAMP.test(r.at) && !Number.isNaN(Date.parse(r.at)) ? r.at : null;
  if (
    kind === undefined ||
    exercise === null ||
    (r.next !== null && next === null) ||
    (undo ? at === null : r.at !== null) ||
    typeof r.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
    typeof r.session !== "number" ||
    !Number.isInteger(r.session) ||
    r.session < 1 ||
    r.session > MAX_SESSION
  ) {
    return null;
  }
  return { kind, exercise, next, date: r.date, session: r.session, at };
}
