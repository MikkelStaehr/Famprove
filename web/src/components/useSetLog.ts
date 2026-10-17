"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { logExerciseTap } from "@/app/actions";
import { freshAfterTap, type FreshTicks, initialFresh } from "@/lib/fresh-ticks";
import { jumpFailure } from "@/lib/jump-save";
import {
  applyChanges,
  applyOrderChanges,
  applyTap,
  type JumpMark,
  type LoggedSet,
  rangeTops,
  refused,
  setKey,
  type SetRef,
  type SetTapInput,
  type SessionShape,
  type SetTapKind,
  shapeOrder,
  transition,
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
  /** The tap order in force: the `order` passed in, or after a jump this visit, the jumped one (fokus-sheet.md R1). */
  readonly order: readonly SetRef[];
  /**
   * The latest jump that did not land (fokus-sheet.md §Copy): `failed` (Gem igen re-taps it) or
   * `refused`. Either way the order went back to the stored one: a jump is in the order only while
   * its save is pending or saved, so the client never orders differently from the server (as
   * supersets' orderPairs). Null = none.
   */
  readonly jumpProblem: JumpProblem | null;
  /** The session's shape in force (with the jump's undo mark), for Fortryd's target; absent without a shape. */
  readonly shape?: SessionShape;
};

/** The order and undo mark after a jump or its Fortryd this visit. */
type Jumped = { readonly runRows: readonly number[] | null; readonly jump: JumpMark | null };

export type JumpProblem = { readonly row: number; readonly kind: "failed" | "refused" };

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
  /** The session's runs, pairs and stored order: a `jump` needs them (Fokus); without it a jump does nothing. */
  shape?: SessionShape,
): SetLog {
  // A jump or its Fortryd this visit (the server stores it in session_order with its undo mark; a
  // reload reads both back into `shape`).
  const [jumped, setJumped] = useState<Jumped | null>(null);
  const liveShape = useMemo(
    () => (shape === undefined ? undefined : jumped === null ? shape : { ...shape, runRows: jumped.runRows, jump: jumped.jump }),
    [shape, jumped],
  );
  // A jump's local time -> the server's T (its jumped_at), so Fortryd's guard names the stored jump.
  const serverJumpAt = useRef(new Map<string, string>());
  const live = useMemo(
    () => (liveShape === undefined || jumped === null ? order : shapeOrder(liveShape)),
    [liveShape, jumped, order],
  );
  const tops = useMemo(() => rangeTops(rows), [rows]);
  const [log, setLog] = useState<ReadonlyMap<string, LoggedSet>>(
    () => new Map(initial.map((l) => [setKey(l), l])),
  );
  const [fresh, setFresh] = useState<FreshTicks>(initialFresh);
  // Failed taps, in order, outside React state: a retry must send each exactly once.
  const failed = useRef<SetTapInput[]>([]);
  const [unsaved, setUnsaved] = useState(0);
  const [jumpProblem, setJumpProblem] = useState<JumpProblem | null>(null);
  // Every tap counts up; a jump keeps what it replaced, so a save that doesn't land can put it back.
  const tapSeq = useRef(0);
  const jumpSnap = useRef<{ readonly seq: number; readonly log: ReadonlyMap<string, LoggedSet>; readonly jumped: Jumped | null } | null>(null);
  const [rejected, setRejected] = useState(false);
  const [dev, setDev] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  // Each set's latest done / skip / undo, updated in the tap itself (not in render): a feel or
  // reps tap from a stale closure (the reps stepper's flush as the pause unmounts after Fortryd)
  // must not reach a set that is no longer done.
  const lastMark = useRef(new Map<string, SetTapKind>());

  const countFailed = useCallback(() => {
    setUnsaved(new Set(failed.current.map((f) => setKey(f))).size);
  }, []);

  /** A jump's save: stored keeps the order; failed or refused puts back what the jump replaced. */
  const sendJump = useCallback(async (input: SetTapInput, seq: number, localAt: string) => {
    let outcome: JumpProblem["kind"] | null = "failed";
    try {
      const result = await logExerciseTap(input);
      if (result.ok) {
        outcome = null;
        serverJumpAt.current.set(localAt, result.at);
      }
      else if (result.reason === "dev") {
        setDev(true); // fixtures write nothing; the jump shows as if stored
        outcome = null;
      } else if (result.reason === "invalid") outcome = "refused";
    } catch {
      // offline, or a deployment that no longer knows this action: failed
    }
    const snap = jumpSnap.current;
    if (snap === null || snap.seq !== seq) return; // a newer jump owns the order
    jumpSnap.current = null;
    if (outcome === null) return;
    // Nothing tapped after the jump: back to the stored order and log. Later taps built on the
    // moved log, which the server doesn't have: the reload state.
    if (jumpFailure(tapSeq.current !== seq) === "reload") {
      setRejected(true);
      return;
    }
    setLog(snap.log);
    setJumped(snap.jumped);
    setJumpProblem({ row: input.row, kind: outcome });
  }, []);

  const send = useCallback(
    async (sent: SetTapInput) => {
      // A jump's Fortryd names the stored jump: its server time once the jump's save has returned.
      const input = sent.seen == null ? sent : { ...sent, seen: serverJumpAt.current.get(sent.seen) ?? sent.seen };
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
      if (kind === "jump") {
        // The shared transition (lib/set-taps applyTap) with the session's shape; the new order is jumpRunRows.
        if (liveShape === undefined) return;
        const at = new Date().toISOString();
        const changes = transition(live, log, { kind, target: ref, undoes: null, value: null }, at, tops, liveShape);
        if (changes === null) return; // a done run or no run: the server refuses it too
        tapSeq.current += 1;
        const seq = tapSeq.current;
        jumpSnap.current = { seq, log, jumped };
        setJumpProblem(null);
        setLog((previous) => applyTap(live, previous, "jump", ref, at, null, tops, liveShape));
        const next = applyOrderChanges(liveShape, changes);
        setJumped({ runRows: next.runRows, jump: next.jump ?? null });
        const input: SetTapInput = { kind, date, session, row: ref.row, set: ref.set, undoes: null };
        queue.current = queue.current.then(() => sendJump(input, seq, at));
        return;
      }
      if (kind === "undo" && liveShape?.jump != null && undoesOf(log, ref, liveShape) === "jump") {
        // Fortryd of the latest jump or chain (slice jump-undo): the shared transition, guarded on the jump seen.
        const seen = liveShape.jump.jumpedAt;
        const changes = transition(live, log, { kind, target: ref, undoes: "jump", value: null, seen }, new Date().toISOString(), tops, liveShape);
        if (changes === null || changes.length === 0) return;
        tapSeq.current += 1;
        setLog((previous) => applyChanges(previous, changes));
        const next = applyOrderChanges(liveShape, changes);
        setJumped({ runRows: next.runRows, jump: next.jump ?? null });
        const input: SetTapInput = { kind, date, session, row: ref.row, set: ref.set, undoes: "jump", seen };
        queue.current = queue.current.then(() => send(input));
        return;
      }
      tapSeq.current += 1;
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
      setLog((previous) => applyTap(live, previous, kind, ref, new Date().toISOString(), value, tops));
      setFresh((previous) => freshAfterTap(previous, kind, setKey(ref)));
      const withValue = kind === "feel" || kind === "reps";
      const input: SetTapInput = { kind, date, session, row: ref.row, set: ref.set, undoes, ...(withValue ? { value } : {}) };
      queue.current = queue.current.then(() => send(input));
    },
    [log, live, liveShape, jumped, date, session, send, sendJump, countFailed, tops],
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

  return { log, fresh, tap, unsaved, retry, rejected, dev, flush, failedNow, order: live, jumpProblem, ...(liveShape === undefined ? {} : { shape: liveShape }) };
}
