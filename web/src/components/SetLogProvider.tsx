"use client";

import { createContext, type ReactNode, use, useCallback, useMemo, useRef, useState } from "react";

import { setSupersetPair } from "@/app/actions";
import { REDUCED_MOTION } from "@/lib/motion";
import {
  clientOrder,
  clientPairs,
  orderPairs,
  SEAM_IDLE,
  type SeamSave,
  seamReducer,
  seamSentence,
  type SeamView,
  seamViews,
  slotKey,
} from "@/lib/superset-view";
import { checklistView, type ChecklistView, type StrengthSession } from "@/lib/training-view";

import { type SetLog, useSetLog } from "./useSetLog";

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
};

const SessionContext = createContext<SessionState | null>(null);

type ProviderProps = {
  readonly session: StrengthSession;
  readonly date: string;
  readonly devSwitches: boolean;
  readonly children: ReactNode;
};

export function SetLogProvider({ session, date, devSwitches, children }: ProviderProps) {
  const [saves, setSaves] = useState<ReadonlyMap<string, SeamSave>>(() => new Map());
  const [drawn, setDrawn] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState("");
  const pairs = useMemo(() => clientPairs(session.pairSlots, saves), [session.pairSlots, saves]);
  // The order follows only stored choices: a failed save stays on the seam (S7), not in the order.
  const ordered = useMemo(() => orderPairs(session.pairSlots, saves), [session.pairSlots, saves]);
  const order = useMemo(
    () => (saves.size === 0 ? session.order : clientOrder(session.exercises, ordered)),
    [saves.size, session.order, session.exercises, ordered],
  );
  const setLog = useSetLog(session.log, order, date, session.session, session.exercises);
  const view = useMemo(() => checklistView(session.exercises, order, setLog.log), [session.exercises, order, setLog.log]);
  const views = useMemo(
    () => seamViews(session.exercises, session.pairSlots, pairs, setLog.log.values()),
    [session.exercises, session.pairSlots, pairs, setLog.log],
  );
  // Each seam's latest tap: an older reply never overwrites a newer choice.
  const seq = useRef(new Map<string, number>());

  const toggle = useCallback(
    (v: SeamView, paired: boolean) => {
      const key = slotKey(v);
      const n = (seq.current.get(key) ?? 0) + 1;
      seq.current.set(key, n);
      setSaves((m) => new Map(m).set(key, seamReducer(m.get(key) ?? SEAM_IDLE, { kind: "tap", paired })));
      setStatus(seamSentence(v, paired));
      const animate = !window.matchMedia(REDUCED_MOTION).matches;
      setDrawn((d) => {
        const next = new Set(d);
        if (paired && animate) next.add(key);
        else next.delete(key);
        return next;
      });
      void setSupersetPair({ date, sessionNo: session.session, rowA: v.rowA, rowB: v.rowB, paired })
        .catch(() => null)
        .then((result) => {
          if (seq.current.get(key) !== n) return;
          setSaves((m) => new Map(m).set(key, seamReducer(m.get(key) ?? { override: paired, status: "saving" }, { kind: "result", result })));
        });
    },
    [date, session.session],
  );

  const seams = useMemo(() => ({ views, saves, drawn, status, toggle }), [views, saves, drawn, status, toggle]);
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
