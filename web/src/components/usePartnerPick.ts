"use client";

import { useCallback, useMemo, useState } from "react";

import { setSupersetPair } from "@/app/actions";
import { pickAfter, pickedShape, pickOutcome } from "@/lib/pick-save";
import { pickedOrder, pickedSlot, pickSentence, type SeamView, slotKey } from "@/lib/superset-view";
import type { PairSlot } from "@/lib/supersets";
import { type ExerciseView, titleName } from "@/lib/training-view";

import type { SetLog } from "./useSetLog";
import { type SupersetSaves, useSupersetSaves } from "./useSupersetSaves";

/** The set log's queue a pick goes through (useSetLog). */
export type PickQueue = Pick<SetLog, "pushPick" | "jumped" | "adoptOrder">;

/** A pick that didn't land: `failed` has Gem igen (the set log's retry), `refused` none. */
export type PickProblem = { readonly rowA: number; readonly kind: "failed" | "refused"; readonly text: string; readonly sub: string | null };

type Named = Pick<ExerciseView, "name" | "variant" | "variantId" | "row" | "sets">;

export type PartnerPick = SupersetSaves & {
  /** The run order the screens follow: the optimistic pick's, else the stored one (null = the sheet's). */
  readonly runRows: readonly number[] | null;
  /** The server's slots plus the (A, B) slots picks made this visit. */
  readonly slots: readonly PairSlot[];
  /** Slots a pick made this visit (their failed line is superset-any.md §11's). */
  readonly picked: ReadonlySet<string>;
  /** §11–12: a failed (Gem igen) or refused pick's line, under A's seam (Fokus: under the top bar); null = none. */
  readonly problem: PickProblem | null;
  /** §8: B moves right after A and is paired, saved through the set log's queue like a jump. */
  readonly pick: (v: Pick<SeamView, "rowA" | "nameA">, rowB: number, queue: PickQueue) => void;
  /** A pick is in force this visit: a pending jump mark no longer applies (the pick is newer). */
  readonly pickedAny: boolean;
};

/** superset-any.md §8–12 on top of useSupersetSaves, shared by Træning and Fokus. */
export function usePartnerPick(
  exercises: readonly Named[],
  storedRunRows: readonly number[] | null,
  serverSlots: readonly PairSlot[],
  date: string,
  sessionNo: number,
): PartnerPick {
  const [pickedRows, setPickedRows] = useState<readonly number[] | null>(null);
  const [extra, setExtra] = useState<readonly PairSlot[]>([]);
  const [problem, setProblem] = useState<PickProblem | null>(null);
  const runRows = pickedRows ?? storedRunRows;
  const slots = useMemo(() => [...serverSlots, ...extra], [serverSlots, extra]);
  const saves = useSupersetSaves(slots, date, sessionNo);
  const save = saves.toggle;

  const toggle = useCallback<SupersetSaves["toggle"]>(
    (v, paired, sentence, onResult) => {
      setProblem(null);
      save(v, paired, sentence, onResult);
    },
    [save],
  );

  const pick = useCallback(
    (v: Pick<SeamView, "rowA" | "nameA">, rowB: number, queue: PickQueue) => {
      const stored = pickedRows;
      const jumpedBefore = queue.jumped;
      const next = pickedOrder(exercises, runRows, v.rowA, rowB);
      const eb = exercises.find((e) => e.row === rowB);
      const b = eb === undefined ? "" : titleName(eb);
      const slot = pickedSlot(v.rowA, rowB);
      const target: SeamView = { rowA: v.rowA, rowB, state: "available", nameA: v.nameA, nameB: b, both: `${v.nameA} og ${b}`, started: b };
      // Optimistic while saving (and again on each Gem igen); the stored order comes back on failure or refusal.
      const apply = () => {
        setProblem(null);
        setExtra((xs) => (xs.some((x) => slotKey(x) === slotKey(slot)) ? xs : [...xs, slot]));
        if (next !== null) {
          setPickedRows(next);
          if (jumpedBefore !== null) queue.adoptOrder(pickedShape(jumpedBefore, next));
        }
        saves.mark(target, { kind: "tap" });
      };
      apply();
      saves.mark(target, { kind: "tap" }, pickSentence(v.nameA, b));
      let attempt = 0;
      queue.pushPick({ kind: "pick", row: v.rowA, set: 0, rowB }, async () => {
        attempt += 1;
        if (attempt > 1) apply();
        const result = await setSupersetPair({ date, sessionNo, rowA: v.rowA, rowB, paired: true }).catch(() => null);
        const outcome = pickOutcome(result);
        const after = pickAfter(outcome, stored, result !== null && result.ok && result.runRows !== undefined ? result.runRows : next);
        if (after.line === null) {
          saves.mark(target, { kind: "result", result });
          if (after.runRows !== null) setPickedRows(after.runRows);
          return outcome;
        }
        // Rule 11 / 12: back to the stored order and pair at once.
        setPickedRows(after.runRows);
        queue.adoptOrder(jumpedBefore);
        saves.mark(target, { kind: "clear" });
        setExtra((xs) => xs.filter((x) => slotKey(x) !== slotKey(slot)));
        if (after.line === "failed") {
          setProblem({ rowA: v.rowA, kind: "failed", text: `Supersettet med ${b} er ikke gemt.`, sub: "Rækkefølgen står her, men forsvinder, hvis siden genindlæses." });
        } else {
          const why = result !== null && !result.ok && result.reason === "started" ? `fordi ${b} er gået i gang` : "fordi sessionen er ændret";
          setProblem({ rowA: v.rowA, kind: "refused", text: `${b} kan ikke tages som superset med ${v.nameA}, ${why}. Rækkefølgen er som før.`, sub: null });
        }
        return outcome;
      });
    },
    [exercises, pickedRows, runRows, saves, date, sessionNo],
  );
  const picked = useMemo(() => new Set(extra.map(slotKey)), [extra]);
  return { ...saves, toggle, runRows, slots, picked, problem, pick, pickedAny: pickedRows !== null };
}
