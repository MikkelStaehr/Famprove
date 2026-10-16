"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { logExerciseTap } from "@/app/actions";
import { freshAfterTap, type FreshTicks, initialFresh } from "@/lib/fresh-ticks";
import {
  applyTap,
  type LoggedSet,
  rangeTops,
  refused,
  setKey,
  type SetRef,
  type SetTapInput,
  type SetTapKind,
  undoesOf,
} from "@/lib/set-taps";

/**
 * The Træning screens' set state (spec traening.md §7): seeded from the set log the server read
 * back, so progress survives a reload. A tap shows at once (the server's rules applied locally,
 * lib/set-taps.ts applyTap) and is saved behind it through the one server action, one at a time
 * and in order, so an undo always reaches the server after the tap it undoes.
 * A failed save keeps its place in `unsaved` (in order) until `retry` resends it; the server then
 * stamps the retry's own time (the client never sends a time). Under DEV_TODAY / DEV_FIXTURE the
 * server writes nothing and `dev` turns on.
 */
export type SetLog = {
  readonly log: ReadonlyMap<string, LoggedSet>;
  /** Sets ticked done by a tap since load (lib/fresh-ticks): only these draw / pop. Never a restored tick. */
  readonly fresh: FreshTicks;
  /** `value`: a feel (-1/0/+1, null clears) or the reps done; omitted for the other kinds. */
  readonly tap: (kind: SetTapKind, ref: SetRef, value?: number | null) => void;
  readonly unsaved: number; // sets with a tap whose save failed, waiting for retry
  readonly retry: () => void;
  readonly rejected: boolean; // the server refused a tap (e.g. the day changed): reload the page
  readonly dev: boolean; // the dev switches are on: nothing is saved
  /** Resolves when every queued save has been sent (before leaving a screen). */
  readonly flush: () => Promise<void>;
  /** Taps whose save failed right now (a ref, not render state: safe after an await). */
  readonly failedNow: () => number;
};

/** How long leaving a screen waits for queued saves before it goes anyway (offline, slow). */
export const FLUSH_WAIT_MS = 3000;

/** Waits for `flush` at most FLUSH_WAIT_MS. */
/** Waits for the queued saves, at most FLUSH_WAIT_MS; true when they were all sent in time. */
export function settle(flush: () => Promise<void>): Promise<boolean> {
  return Promise.race([
    flush().then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), FLUSH_WAIT_MS)),
  ]);
}

export function useSetLog(
  initial: readonly LoggedSet[],
  order: readonly SetRef[],
  date: string,
  session: number,
  /** The session's rows (reps as written, sets): a done on a range set stores its top, as the server. */
  rows: readonly { readonly repsText: string | null; readonly sets: readonly SetRef[] }[],
): SetLog {
  const tops = useMemo(() => rangeTops(rows), [rows]);
  const [log, setLog] = useState<ReadonlyMap<string, LoggedSet>>(
    () => new Map(initial.map((l) => [setKey(l), l])),
  );
  const [fresh, setFresh] = useState<FreshTicks>(initialFresh);
  // Failed taps, in order, outside React state: a retry must send each exactly once.
  const failed = useRef<SetTapInput[]>([]);
  const [unsaved, setUnsaved] = useState(0);
  const [rejected, setRejected] = useState(false);
  const [dev, setDev] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  // Each set's latest done / skip / undo, updated in the tap itself (not in render): a feel or
  // reps tap from a stale closure (the reps stepper's flush as the pause unmounts after Fortryd)
  // must not reach a set that is no longer done.
  const lastMark = useRef(new Map<string, SetTapKind>());

  const countFailed = useCallback(() => setUnsaved(new Set(failed.current.map((f) => setKey(f))).size), []);

  const send = useCallback(
    async (input: SetTapInput) => {
      try {
        const result = await logExerciseTap(input);
        if (result.ok) return;
        if (result.reason === "dev") setDev(true);
        else if (result.reason === "invalid") setRejected(true); // a retry can't fix it: reload
        else failed.current.push(input);
      } catch {
        failed.current.push(input); // offline, or a deployment that no longer knows this action
      }
      countFailed();
    },
    [countFailed],
  );

  const tap = useCallback(
    (kind: SetTapKind, ref: SetRef, value: number | null = null) => {
      if (refused(log, kind, ref)) return; // the server would refuse it too (skip of a done set)
      if ((kind === "feel" || kind === "reps") && lastMark.current.get(setKey(ref)) === "undo") return;
      if (kind === "done" || kind === "skip" || kind === "undo") lastMark.current.set(setKey(ref), kind);
      const undoes = kind === "undo" ? undoesOf(log, ref) : null;
      if (kind === "undo" && undoes === null) return; // nothing this set's taps wrote
      if (kind === "undo") {
        // An unsaved tap on this set must not be resent after its undo; the undo itself is still
        // sent (the server applies it only if that tap landed after all).
        failed.current = failed.current.filter((f) => setKey(f) !== setKey(ref));
        countFailed();
      }
      setLog((previous) => applyTap(order, previous, kind, ref, new Date().toISOString(), value, tops));
      setFresh((previous) => freshAfterTap(previous, kind, setKey(ref)));
      const withValue = kind === "feel" || kind === "reps";
      const input: SetTapInput = { kind, date, session, row: ref.row, set: ref.set, undoes, ...(withValue ? { value } : {}) };
      queue.current = queue.current.then(() => send(input));
    },
    [log, order, date, session, send, countFailed, tops],
  );

  const retry = useCallback(() => {
    const pending = failed.current;
    failed.current = [];
    countFailed();
    queue.current = queue.current.then(async () => {
      for (const input of pending) await send(input);
    });
  }, [send, countFailed]);

  const flush = useCallback(() => queue.current, []);
  const failedNow = useCallback(() => failed.current.length, []);

  return { log, fresh, tap, unsaved, retry, rejected, dev, flush, failedNow };
}
