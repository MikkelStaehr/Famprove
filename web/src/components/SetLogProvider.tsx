"use client";

import { createContext, type ReactNode, use, useCallback, useMemo } from "react";

import {
  clientOrder,
  movedUpRows,
  partnerRows,
  type PartnerRowView,
  runRowsOf,
  type SeamSave,
  seamSentence,
  type SeamView,
  seamViews,
  unpairSentence,
} from "@/lib/superset-view";
import { checklistView, type ChecklistView, partnerViews, type StrengthSession } from "@/lib/training-view";

import { type SetLog, useSetLog } from "./useSetLog";
import { type PickProblem, usePartnerPick } from "./usePartnerPick";

/**
 * The open session's set state for Træning (spec traening.md §3.1.4, §3.3): the header's
 * Begynd / Fortsæt button and the strength card's list read the same log, with ride cards
 * (server components) in between, so the state lives in one context around the page.
 * The superset seams (supersets.md S1–S9) live here too: a switch changes the tap order, so
 * NÆSTE and the progress follow it (S5).
 */
type SessionState = {
  readonly session: StrengthSession;
  readonly date: string;
  readonly setLog: SetLog;
  readonly view: ChecklistView;
  /** DEV_TODAY / DEV_FIXTURE are on (the server knows before the first tap): nothing is saved. */
  readonly devSwitches: boolean;
  readonly seams: Seams;
};

export type Seams = {
  readonly views: readonly SeamView[];
  readonly saves: ReadonlyMap<string, SeamSave>;
  /** Slots switched on by a tap this visit: only these draw their rail (S6). */
  readonly drawn: ReadonlySet<string>;
  readonly status: string; // S9, one polite status
  readonly toggle: (v: SeamView, paired: boolean) => void;
  /** superset-any.md §5–6: ⇄'s partner list for A, live; null = ⇄ isn't offered for A. */
  readonly partnersFor: (rowA: number) => readonly PartnerRowView[] | null;
  /** §8: pick B for A's seam: B moves right after A and is paired (one save). */
  readonly pick: (v: SeamView, rowB: number) => void;
  /** §9–10: B rows moved up under their A ("Rykket op · kun i dag"). */
  readonly movedUp: ReadonlySet<number>;
  /** The pairs in force on the client (for R2's moved-up row placement). */
  readonly pairs: readonly { readonly rowA: number; readonly rowB: number }[];
  /** Slots a pick made this visit (their failed line is §11's). */
  readonly picked: ReadonlySet<string>;
  /** §11–12: a failed or refused pick's line, under A's seam; null = none. Gem igen = the set log's retry. */
  readonly problem: PickProblem | null;
  readonly retry: () => void;
};

const SessionContext = createContext<SessionState | null>(null);

type ProviderProps = {
  readonly session: StrengthSession;
  readonly date: string;
  readonly devSwitches: boolean;
  readonly children: ReactNode;
};

export function SetLogProvider({ session, date, devSwitches, children }: ProviderProps) {
  // superset-any.md §8: a pick moves B after A at once (the optimistic run order) and adds the (A, B) slot.
  const { saves, pairs, ordered, drawn, status, toggle: save, runRows, slots, picked, problem, pick: pickPartner, pickedAny } = usePartnerPick(
    session.exercises,
    session.runRows ?? null,
    session.pairSlots,
    date,
    session.session,
  );
  // The order follows only stored choices: a failed save stays on the seam (S7), not in the order.
  const order = useMemo(
    () => (saves.size === 0 && !pickedAny ? session.order : clientOrder(session.exercises, ordered, runRows)),
    [saves.size, pickedAny, session.order, session.exercises, ordered, runRows],
  );
  const setLog = useSetLog(session.log, order, date, session.session, session.exercises);
  const view = useMemo(() => checklistView(session.exercises, order, setLog.log), [session.exercises, order, setLog.log]);
  const views = useMemo(
    () => seamViews(session.exercises, slots, pairs, setLog.log.values(), runRows),
    [session.exercises, slots, pairs, setLog.log, runRows],
  );
  const toggle = useCallback(
    (v: SeamView, paired: boolean) => save(v, paired, paired ? seamSentence(v, paired) : unpairSentence(v)),
    [save],
  );
  const partnersFor = useCallback(
    (rowA: number) => {
      const list = partnerViews(session.exercises, session.partnerData, runRows, pairs, setLog.log.values(), rowA);
      return list === null ? null : partnerRows(list, session.exercises, (row) => runRowsOf(session.exercises, row));
    },
    [session.exercises, session.partnerData, runRows, pairs, setLog.log],
  );
  const pick = useCallback((v: SeamView, rowB: number) => pickPartner(v, rowB, setLog), [pickPartner, setLog]);
  const movedUp = useMemo(() => movedUpRows(session.exercises, pairs), [session.exercises, pairs]);

  const seams = useMemo(
    () => ({ views, saves, drawn, status, toggle, partnersFor, pick, movedUp, picked, problem, pairs, retry: setLog.retry }),
    [views, saves, drawn, status, toggle, partnersFor, pick, movedUp, picked, problem, pairs, setLog.retry],
  );
  const value = useMemo(
    () => ({ session, date, setLog, view, devSwitches, seams }),
    [session, date, setLog, view, devSwitches, seams],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionState {
  const state = use(SessionContext);
  if (state === null) throw new Error("useSession must be used inside <SetLogProvider>");
  return state;
}
