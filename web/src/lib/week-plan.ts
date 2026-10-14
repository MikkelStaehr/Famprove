/**
 * The week's strength plan, shared by Træning's Uge card and /load's week list (user 2026-10-14,
 * slice week-shared): which session is today's (session k + 1, "I DAG"), which are done (with
 * their date), and which are planned without a date ("–" + "plan"). Pure; the input is the
 * StrengthWeek that training-view builds from strength_sessions + strength_sets ("the n-th strength
 * activity of the ISO week is session n", never weekdays).
 */
import type { IsoDate } from "./db/rows.ts";
import type { DoneSession, StrengthWeek } from "./training-view.ts";

/** One row of the week list, in session order; extras after the plan. */
export type WeekRow =
  | { readonly kind: "done"; readonly session: number; readonly sets: number | null; readonly done: DoneSession }
  | { readonly kind: "extra"; readonly done: DoneSession }
  | { readonly kind: "current"; readonly session: number; readonly sets: number }
  | { readonly kind: "future"; readonly session: number; readonly sets: number };

/** What a week list needs: the week's prescribed sessions (columns) and its done activities. */
export type WeekPlanInput = Pick<StrengthWeek, "columns" | "done">;

/**
 * The week list from the week's columns and done activities: a done session carries its date and
 * activity words; the current one (session k + 1) is today's; later ones have no date until done.
 * When a session is already done today (`today` given), the next one is not also today's: it is
 * planned without a date ("–" + "plan"), so today never carries two sessions.
 */
export function weekRows(strength: WeekPlanInput, today?: IsoDate): readonly WeekRow[] {
  const rows: WeekRow[] = [];
  const doneToday = today !== undefined && strength.done.some((d) => !d.extra && d.date === today);
  for (const c of strength.columns) {
    const done = strength.done.find((d) => !d.extra && d.session === c.session);
    if (done !== undefined) rows.push({ kind: "done", session: c.session, sets: c.sets, done });
    else if (c.status === "current" && !doneToday) rows.push({ kind: "current", session: c.session, sets: c.sets });
    else rows.push({ kind: "future", session: c.session, sets: c.sets });
  }
  for (const d of strength.done) {
    if (d.extra) rows.push({ kind: "extra", done: d });
    else if (!strength.columns.some((c) => c.session === d.session)) {
      rows.push({ kind: "done", session: d.session, sets: null, done: d });
    }
  }
  return rows;
}

/** A planned (not done) session's words, the same on both screens: "Styrke · session 2". */
export function planLabel(session: number): string {
  return `Styrke · session ${session}`;
}

/** A not-done session for a dated week list. */
export type PlannedSession = { readonly kind: "current" | "future"; readonly session: number };

/**
 * The plan part of a dated week list (/load): the current session goes on today's row when that
 * day is listed; otherwise (no daily_load row for today yet) it joins the undated rows, first.
 * When a session is already done today, the current one is planned without a date (weekRows), so
 * today's row never reads "Styrke · session 1 · Styrke · session 2".
 * Done sessions are not repeated here: the dated list already has them on their day.
 */
export type DatedPlan = {
  readonly today: PlannedSession | null; // shown on today's day row with "I DAG"
  readonly undated: readonly PlannedSession[]; // "–" + "plan" (or "I DAG" for a current one), after the days
};

export function datedPlan(strength: WeekPlanInput, today: IsoDate, listed: readonly IsoDate[]): DatedPlan {
  const open = weekRows(strength, today).filter(
    (r): r is Extract<WeekRow, { kind: "current" | "future" }> => r.kind === "current" || r.kind === "future",
  );
  const planned = open.map((r): PlannedSession => ({ kind: r.kind, session: r.session }));
  const current = planned.find((p) => p.kind === "current") ?? null;
  const onToday = current !== null && listed.includes(today) ? current : null;
  return { today: onToday, undated: planned.filter((p) => p !== onToday) };
}
