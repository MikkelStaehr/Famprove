"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { setSetParts } from "@/app/actions";
import { type PartsDraft, partsToSave } from "@/lib/parts-editor";
import { setKey } from "@/lib/set-taps";

export type PartsProblem = { readonly set: number; readonly kind: "failed" | "refused" };

/**
 * The parts editor's optimistic state and its autosave (combo-parts.md R2, §6, §8): drafts are
 * kept per set for the screen's life (Fortryd and a re-done pre-fill from them, §7); a dirty draft
 * is saved on the next done, on Afslut and when the page is hidden. Fields never clear; a failed
 * save keeps the draft dirty for Gem igen.
 */
export function usePartsSave(date: string, sessionNo: number) {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, PartsDraft>>(() => new Map());
  const [problem, setProblem] = useState<PartsProblem | null>(null);
  const inFlight = useRef<Promise<void>>(Promise.resolve());

  const draftOf = useCallback((row: number, set: number) => drafts.get(setKey({ row, set })) ?? null, [drafts]);

  const edit = useCallback((draft: PartsDraft) => {
    setDrafts((m) => new Map(m).set(setKey(draft), draft));
  }, []);

  /** Saves every dirty draft; `shown` is the editor's draft when it was never edited (pre-filled, R2). */
  const save = useCallback(
    (shown: PartsDraft | null = null): Promise<void> => {
      const all = new Map(drafts);
      if (shown !== null && !all.has(setKey(shown))) all.set(setKey(shown), shown);
      const due = [...all.values()].filter((d) => d.dirty);
      if (due.length === 0) return inFlight.current;
      setDrafts(() => {
        const m = new Map(all);
        for (const d of due) m.set(setKey(d), { ...d, dirty: false });
        return m;
      });
      const run = async () => {
        for (const d of due) {
          const parts = partsToSave(d);
          if (parts.length === 0) continue;
          let kind: PartsProblem["kind"] | null = null;
          try {
            const result = await setSetParts({ date, sessionNo, row: d.row, set: d.set, parts });
            if (!result.ok) kind = result.reason === "failed" ? "failed" : "refused";
          } catch {
            kind = "failed";
          }
          if (kind === "failed") {
            // Dirty again for Gem igen (a newer edit since is already dirty).
            setDrafts((m) => {
              const now = m.get(setKey(d));
              return now === undefined || now.dirty ? m : new Map(m).set(setKey(d), { ...now, dirty: true });
            });
          }
          const failed = kind;
          setProblem((p) => (failed !== null ? { set: d.set, kind: failed } : p !== null && p.set === d.set ? null : p));
        }
      };
      inFlight.current = inFlight.current.then(run, run);
      return inFlight.current;
    },
    [date, sessionNo, drafts],
  );

  // §8 / R2: hiding the page (app switch, lock) saves the edits.
  const latest = useRef(save);
  useEffect(() => {
    latest.current = save;
  }, [save]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void latest.current();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  return { draftOf, edit, save, problem };
}
