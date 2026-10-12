"use client";

import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { logExerciseTap } from "@/app/actions";
import { exerciseKey, type TapChange } from "@/lib/exercise-taps";

/**
 * "Done" ticks for Today's sheet rows, held in memory only (DESIGN.md › Today › Tick state).
 * Lives in the root layout, so it survives in-app navigation (Today -> Training load -> Today)
 * and clears on reload. No storage, no cookies: ticking works offline.
 *
 * The exercise timing taps (exercise_log, lib/exercise-taps.ts) go out from here too: one save
 * at a time, in order, so an undo waits for the tap it undoes. The timestamp the server returns
 * for a tap that wrote something is kept beside the ticks (same lifetime) and sent back on undo;
 * a tap that wrote nothing (a re-tick after a reload) has nothing to undo.
 */
export type TapOutcome = "saved" | "dev" | "failed";

type Ticks = {
  readonly ticked: ReadonlySet<string>;
  readonly setTicked: (key: string, done: boolean) => void;
  readonly saveTap: (change: TapChange, date: string, session: number) => Promise<TapOutcome>;
};

const TickContext = createContext<Ticks | null>(null);

export function TickProvider({ children }: { readonly children: ReactNode }) {
  const [ticked, setTicks] = useState<ReadonlySet<string>>(() => new Set());
  const written = useRef(new Map<string, string>()); // tap key -> the timestamp the server wrote
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const setTicked = useCallback((key: string, done: boolean) => {
    setTicks((previous) => {
      if (previous.has(key) === done) return previous;
      const next = new Set(previous);
      if (done) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const saveTap = useCallback((change: TapChange, date: string, session: number) => {
    const tapKey = (kind: "start" | "end") => `${date}|${session}|${exerciseKey(change.exercise)}|${kind}`;
    const undoes = change.kind === "undo-end" ? "end" : change.kind === "undo-start" ? "start" : null;
    const run = queue.current.then(async (): Promise<TapOutcome> => {
      const at = undoes === null ? null : (written.current.get(tapKey(undoes)) ?? null);
      if (undoes !== null && at === null) return "saved"; // its tap wrote nothing: nothing to undo
      try {
        const result = await logExerciseTap({ ...change, date, session, at });
        if (!result.ok) return result.reason === "dev" ? "dev" : "failed";
        if (undoes !== null) written.current.delete(tapKey(undoes));
        else if (result.at !== null && (change.kind === "start" || change.kind === "end")) {
          written.current.set(tapKey(change.kind), result.at);
        }
        return "saved";
      } catch {
        return "failed"; // offline, or a deployment that no longer knows this action
      }
    });
    queue.current = run;
    return run;
  }, []);
  const value = useMemo(() => ({ ticked, setTicked, saveTap }), [ticked, setTicked, saveTap]);
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
