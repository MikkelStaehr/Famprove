"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { logExerciseTap } from "@/app/actions";
import { freshAfterTap, type FreshTicks, initialFresh } from "@/lib/fresh-ticks";
import { createSaveQueue, failedBeforeJump, haltingJump, NO_SAVES, type SaveOutcome, type SaveState } from "@/lib/jump-save";
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
 * A failed save keeps its place (in order) until `retry` resends it; the server then stamps the
 * retry's own time (the client never sends a time). A failed jump halts the queue: later taps stay
 * on screen but are held, unsent, until Gem igen saves the jump (lib/jump-save, slice jump-retry). Under DEV_TODAY / DEV_FIXTURE the
 * server writes nothing and `dev` turns on.
 */
export type SetLog = {
  readonly log: ReadonlyMap<string, LoggedSet>;
  /** Sets ticked done by a tap since load (lib/fresh-ticks): only these draw / pop. Never a restored tick. */
  readonly fresh: FreshTicks;
  /** `value`: a feel (-1/0/+1, null clears) or the reps done; omitted for the other kinds. */
  readonly tap: (kind: SetTapKind, ref: SetRef, value?: number | null) => void;
  readonly unsaved: number; // sets with a tap whose save failed, waiting for retry (held taps behind a failed jump: its line)
  readonly retry: () => void;
  readonly rejected: boolean; // the server refused a tap (e.g. the day changed): reload the page
  readonly dev: boolean; // the dev switches are on: nothing is saved
  /** Resolves when every queued save has been sent (before leaving a screen). */
  readonly flush: () => Promise<void>;
  /** Taps not saved right now, failed or held (not render state: safe after an await). */
  readonly failedNow: () => number;
  /** The tap order in force: the `order` passed in, or after a jump this visit, the jumped one (fokus-sheet.md R1). */
  readonly order: readonly SetRef[];
  /**
   * A jump that did not land (fokus-sheet.md §Copy). `failed`: it stays on screen and halts the
   * queue, later taps are held unsent until Gem igen (`retry`) saves it, so the client never orders
   * differently from the server. `refused` with nothing after it: the order went back to the stored
   * one (refused after later taps: `rejected`). Null = none.
   */
  readonly jumpProblem: JumpProblem | null;
  /** The session's shape in force (with the jump's undo mark), for Fortryd's target; absent without a shape. */
  readonly shape?: SessionShape;
  /** superset-any.md rule 11: queue a pick's save behind every earlier tap; it halts the queue if it fails. */
  readonly pushPick: (pick: PickTap, send: () => Promise<SaveOutcome>) => void;
  /** A failed pick halts the queue (its line + Gem igen = retry). */
  readonly pickHalted: boolean;
  /** The order and undo mark after a jump this visit (null = the stored ones). */
  readonly jumped: { readonly runRows: readonly number[] | null; readonly jump: JumpMark | null } | null;
  /** Puts an order in force over the jump's (a landed pick: lib/pick-save pickedShape), or back (null). */
  readonly adoptOrder: (next: { readonly runRows: readonly number[] | null; readonly jump: JumpMark | null } | null) => void;
};

/** A superset pick in the save queue (slice superset-any): A's run start as `row`, set 0; halts like a jump. */
export type PickTap = { readonly kind: "pick"; readonly row: number; readonly set: number; readonly rowB: number };

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
  // A refused jump with nothing after it went back to the stored order: its line (fokus-sheet.md §Copy).
  const [refusedRow, setRefusedRow] = useState<number | null>(null);
  // The save queue (lib/jump-save, slice jump-retry): one at a time and in order; a failed jump
  // halts it, later taps (a jump's Fortryd too) are held behind it until Gem igen saves it.
  const [saves, setSaves] = useState<SaveState<SetTapInput | PickTap>>(NO_SAVES);
  const [queue] = useState(() => createSaveQueue<SetTapInput | PickTap>(setSaves));
  // Each set's latest done / skip / undo, updated in the tap itself (not in render): a feel or
  // reps tap from a stale closure (the reps stepper's flush as the pause unmounts after Fortryd)
  // must not reach a set that is no longer done.
  const lastMark = useRef(new Map<string, SetTapKind>());

  /**
   * One request, made when the tap's turn comes (again on Gem igen). A jump's Fortryd names the
   * stored jump: its server time once the jump's save has returned, so a Fortryd held behind its
   * failed jump names the time the retry stored. A saved jump records that time.
   */
  const request = useCallback(async (sent: SetTapInput, jumpAt: string | null): Promise<SaveOutcome> => {
    const input = sent.seen == null ? sent : { ...sent, seen: serverJumpAt.current.get(sent.seen) ?? sent.seen };
    const result = await logExerciseTap(input);
    if (result.ok) {
      if (jumpAt !== null) serverJumpAt.current.set(jumpAt, result.at);
      return "saved";
    }
    return result.reason === "dev" ? "dev" : result.reason === "invalid" ? "refused" : "failed";
  }, []);

  const tap = useCallback(
    (kind: SetTapKind, ref: SetRef, value: number | null = null) => {
      if (kind === "jump") {
        // The shared transition (lib/set-taps applyTap) with the session's shape; the new order is jumpRunRows.
        if (liveShape === undefined) return;
        const at = new Date().toISOString();
        const changes = transition(live, log, { kind, target: ref, undoes: null, value: null }, at, tops, liveShape);
        if (changes === null) return; // a done run or no run: the server refuses it too
        setRefusedRow(null);
        setLog((previous) => applyTap(live, previous, "jump", ref, at, null, tops, liveShape));
        const next = applyOrderChanges(liveShape, changes);
        setJumped({ runRows: next.runRows, jump: next.jump ?? null });
        const input: SetTapInput = { kind, date, session, row: ref.row, set: ref.set, undoes: null };
        // Refused with nothing after it: back to the order and log the jump replaced.
        queue.push(input, () => request(input, at), () => {
          setLog(log);
          setJumped(jumped);
          setRefusedRow(ref.row);
        });
        return;
      }
      if (kind === "undo" && liveShape?.jump != null && undoesOf(log, ref, liveShape) === "jump") {
        // Fortryd of the latest jump or chain (slice jump-undo): the shared transition, guarded on the jump seen.
        const seen = liveShape.jump.jumpedAt;
        const changes = transition(live, log, { kind, target: ref, undoes: "jump", value: null, seen }, new Date().toISOString(), tops, liveShape);
        if (changes === null || changes.length === 0) return;
        setLog((previous) => applyChanges(previous, changes));
        const next = applyOrderChanges(liveShape, changes);
        setJumped({ runRows: next.runRows, jump: next.jump ?? null });
        const input: SetTapInput = { kind, date, session, row: ref.row, set: ref.set, undoes: "jump", seen };
        queue.push(input, () => request(input, null));
        return;
      }
      if (refused(log, kind, ref)) return; // the server would refuse it too (skip of a done set)
      if ((kind === "feel" || kind === "reps") && lastMark.current.get(setKey(ref)) === "undo") return;
      if (kind === "done" || kind === "skip" || kind === "undo") lastMark.current.set(setKey(ref), kind);
      const undoes = kind === "undo" ? undoesOf(log, ref) : null;
      if (kind === "undo" && undoes === null) return; // nothing this set's taps wrote
      // An unsaved tap on this set must not be resent after its undo; the undo itself is still
      // sent (the server applies it only if that tap landed after all). A jump is never dropped.
      if (kind === "undo") queue.drop((f) => setKey(f) !== setKey(ref));
      setLog((previous) => applyTap(live, previous, kind, ref, new Date().toISOString(), value, tops));
      setFresh((previous) => freshAfterTap(previous, kind, setKey(ref)));
      const withValue = kind === "feel" || kind === "reps";
      const input: SetTapInput = { kind, date, session, row: ref.row, set: ref.set, undoes, ...(withValue ? { value } : {}) };
      queue.push(input, () => request(input, null));
    },
    [log, live, liveShape, jumped, date, session, queue, request, tops],
  );

  const halting = haltingJump(saves);
  const unsaved = new Set(failedBeforeJump(saves).map((f) => setKey(f))).size;
  const jumpProblem: JumpProblem | null =
    halting !== null && halting.kind === "jump" ? { row: halting.row, kind: "failed" } : refusedRow !== null ? { row: refusedRow, kind: "refused" } : null;
  const retry = queue.retry;
  const flush = queue.flush;
  const failedNow = useCallback(() => queue.state().failed.length, [queue]);
  // superset-any.md rule 11: a pick is saved like a jump; its failure halts the queue until Gem igen.
  const pushPick = useCallback((pick: PickTap, send: () => Promise<SaveOutcome>) => queue.push(pick, send), [queue]);
  const pickHalted = halting !== null && halting.kind === "pick";
  // A pick is newer than a jump this visit: its order is in force and the jump's undo mark is gone.
  const adoptOrder = useCallback((next: { readonly runRows: readonly number[] | null; readonly jump: JumpMark | null } | null) => setJumped(next), []);
  const rejected = saves.reload;
  const dev = saves.dev;

  return { log, fresh, tap, unsaved, retry, rejected, dev, flush, failedNow, order: live, jumpProblem, pushPick, pickHalted, jumped, adoptOrder, ...(liveShape === undefined ? {} : { shape: liveShape }) };
}
