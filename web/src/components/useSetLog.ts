"use client";

import { useCallback, useRef, useState } from "react";

import { logExerciseTap } from "@/app/actions";
import {
  applyTap,
  type LoggedSet,
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
  readonly tap: (kind: SetTapKind, ref: SetRef) => void;
  readonly unsaved: number; // sets with a tap whose save failed, waiting for retry
  readonly retry: () => void;
  readonly rejected: boolean; // the server refused a tap (e.g. the day changed): reload the page
  readonly dev: boolean; // the dev switches are on: nothing is saved
  /** Resolves when every queued save has been sent (before leaving a screen). */
  readonly flush: () => Promise<void>;
};

/** How long leaving a screen waits for queued saves before it goes anyway (offline, slow). */
export const FLUSH_WAIT_MS = 3000;

/** Waits for `flush` at most FLUSH_WAIT_MS. */
export function settle(flush: () => Promise<void>): Promise<void> {
  return Promise.race([flush(), new Promise<void>((resolve) => setTimeout(resolve, FLUSH_WAIT_MS))]);
}

export function useSetLog(
  initial: readonly LoggedSet[],
  order: readonly SetRef[],
  date: string,
  session: number,
): SetLog {
  const [log, setLog] = useState<ReadonlyMap<string, LoggedSet>>(
    () => new Map(initial.map((l) => [setKey(l), l])),
  );
  // Failed taps, in order, outside React state: a retry must send each exactly once.
  const failed = useRef<SetTapInput[]>([]);
  const [unsaved, setUnsaved] = useState(0);
  const [rejected, setRejected] = useState(false);
  const [dev, setDev] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

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
    (kind: SetTapKind, ref: SetRef) => {
      if (refused(log, kind, ref)) return; // the server would refuse it too (skip of a done set)
      const undoes = kind === "undo" ? undoesOf(log, ref) : null;
      if (kind === "undo" && undoes === null) return; // nothing this set's taps wrote
      if (kind === "undo") {
        // An unsaved tap on this set must not be resent after its undo; the undo itself is still
        // sent (the server applies it only if that tap landed after all).
        failed.current = failed.current.filter((f) => setKey(f) !== setKey(ref));
        countFailed();
      }
      setLog((previous) => applyTap(order, previous, kind, ref, new Date().toISOString()));
      const input: SetTapInput = { kind, date, session, row: ref.row, set: ref.set, undoes };
      queue.current = queue.current.then(() => send(input));
    },
    [log, order, date, session, send, countFailed],
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

  return { log, tap, unsaved, retry, rejected, dev, flush };
}
