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
  readonly unsaved: number; // taps whose save failed, waiting for retry
  readonly retry: () => void;
  readonly dev: boolean; // the dev switches are on: nothing is saved
};

export function useSetLog(
  initial: readonly LoggedSet[],
  order: readonly SetRef[],
  date: string,
  session: number,
): SetLog {
  const [log, setLog] = useState<ReadonlyMap<string, LoggedSet>>(
    () => new Map(initial.map((l) => [setKey(l), l])),
  );
  const [failed, setFailed] = useState<readonly SetTapInput[]>([]);
  const [dev, setDev] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const send = useCallback(async (input: SetTapInput) => {
    try {
      const result = await logExerciseTap(input);
      if (result.ok) return;
      if (result.reason === "dev") setDev(true);
      else setFailed((f) => [...f, input]);
    } catch {
      setFailed((f) => [...f, input]); // offline, or a deployment that no longer knows this action
    }
  }, []);

  const tap = useCallback(
    (kind: SetTapKind, ref: SetRef) => {
      if (refused(log, kind, ref)) return; // the server would refuse it too (skip of a done set)
      setLog((previous) => applyTap(order, previous, kind, ref, new Date().toISOString()));
      const input: SetTapInput = { kind, date, session, row: ref.row, set: ref.set };
      queue.current = queue.current.then(() => send(input));
    },
    [log, order, date, session, send],
  );

  const retry = useCallback(() => {
    setFailed((pending) => {
      queue.current = queue.current.then(async () => {
        for (const input of pending) await send(input);
      });
      return [];
    });
  }, [send]);

  return { log, tap, unsaved: failed.length, retry, dev };
}
