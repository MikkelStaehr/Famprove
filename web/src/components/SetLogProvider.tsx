"use client";

import { createContext, type ReactNode, use, useMemo } from "react";

import { checklistView, type ChecklistView, type StrengthSession } from "@/lib/training-view";

import { type SetLog, useSetLog } from "./useSetLog";

/**
 * The open session's set state for Træning (spec traening.md §3.1.4, §3.3): the header's
 * Begynd / Fortsæt button and the strength card's list read the same log, with ride cards
 * (server components) in between, so the state lives in one context around the page.
 */
type SessionState = {
  readonly session: StrengthSession;
  readonly date: string;
  readonly setLog: SetLog;
  readonly view: ChecklistView;
  /** DEV_TODAY / DEV_FIXTURE are on (the server knows before the first tap): nothing is saved. */
  readonly devSwitches: boolean;
};

const SessionContext = createContext<SessionState | null>(null);

type ProviderProps = {
  readonly session: StrengthSession;
  readonly date: string;
  readonly devSwitches: boolean;
  readonly children: ReactNode;
};

export function SetLogProvider({ session, date, devSwitches, children }: ProviderProps) {
  const setLog = useSetLog(session.log, session.order, date, session.session);
  const view = useMemo(
    () => checklistView(session.exercises, session.order, setLog.log),
    [session.exercises, session.order, setLog.log],
  );
  const value = useMemo(
    () => ({ session, date, setLog, view, devSwitches }),
    [session, date, setLog, view, devSwitches],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionState {
  const state = use(SessionContext);
  if (state === null) throw new Error("useSession must be used inside <SetLogProvider>");
  return state;
}
