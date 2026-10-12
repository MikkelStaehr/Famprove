"use client";

import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";

/**
 * Stopgap (2026-10-12, until the Træning screens replace it): "done" ticks for the sheet rows,
 * held in memory only. The set log (exercise_set_log) and its server action are per set now; the
 * per-set screens read their state back from it.
 */
type Ticks = {
  readonly ticked: ReadonlySet<string>;
  readonly setTicked: (key: string, done: boolean) => void;
};

const TickContext = createContext<Ticks | null>(null);

export function TickProvider({ children }: { readonly children: ReactNode }) {
  const [ticked, setTicks] = useState<ReadonlySet<string>>(() => new Set());
  const setTicked = useCallback((key: string, done: boolean) => {
    setTicks((previous) => {
      if (previous.has(key) === done) return previous;
      const next = new Set(previous);
      if (done) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ ticked, setTicked }), [ticked, setTicked]);
  return <TickContext value={value}>{children}</TickContext>;
}

export function useTicks(): Ticks {
  const ticks = use(TickContext);
  if (ticks === null) throw new Error("useTicks must be used inside <TickProvider>");
  return ticks;
}

/** The tick key of one sheet row on one date: date + block + sheet row (ExerciseView.key). */
export function tickKey(date: string, exerciseKey: string): string {
  return `${date}|${exerciseKey}`;
}
