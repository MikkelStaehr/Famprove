"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { setSupersetPair } from "@/app/actions";
import { REDUCED_MOTION } from "@/lib/motion";
import type { PairRef } from "@/lib/set-taps";
import { clientPairs, orderPairs, SEAM_IDLE, type SeamSave, seamReducer, type SeamView, slotKey } from "@/lib/superset-view";
import type { PairSlot, PairSource, SupersetResult } from "@/lib/supersets";

/**
 * The ⇄ switch's optimistic state (supersets.md S6–S9), shared by Træning and Fokus: each tap
 * changes the slot at once and writes setSupersetPair once (idempotent); a failed save stays on
 * the seam (S7) but out of the order (orderPairs); a refusal returns to the stored state (S8).
 */
export type SupersetSaves = {
  readonly saves: ReadonlyMap<string, SeamSave>;
  /** The pairs the seams show (a failed choice included). */
  readonly pairs: readonly (PairRef & { readonly source: PairSource })[];
  /** The pairs the tap order follows (stored or saving only). */
  readonly ordered: readonly (PairRef & { readonly source: PairSource })[];
  /** Slots switched on by a tap this visit: only these draw their rail (S6). */
  readonly drawn: ReadonlySet<string>;
  readonly status: string; // S9, one polite status
  /** `sentence`: the S9 status to announce. */
  readonly toggle: (v: SeamView, paired: boolean, sentence: string, onResult?: (result: SupersetResult | null) => void) => void;
  /** A pick's state, saved through the set log's queue (usePartnerPick): a tap, its result, or cleared (back to the stored state). */
  readonly mark: (v: SeamView, event: { readonly kind: "tap" } | { readonly kind: "result"; readonly result: SupersetResult | null } | { readonly kind: "clear" }, sentence?: string) => void;
};

export function useSupersetSaves(slots: readonly PairSlot[], date: string, sessionNo: number): SupersetSaves {
  const [saves, setSaves] = useState<ReadonlyMap<string, SeamSave>>(() => new Map());
  const [drawn, setDrawn] = useState<ReadonlySet<string>>(() => new Set());
  const [status, setStatus] = useState("");
  const pairs = useMemo(() => clientPairs(slots, saves), [slots, saves]);
  const ordered = useMemo(() => orderPairs(slots, saves), [slots, saves]);
  // Each seam's latest tap: an older reply never overwrites a newer choice.
  const seq = useRef(new Map<string, number>());

  const toggle = useCallback(
    (v: SeamView, paired: boolean, sentence: string, onResult?: (result: SupersetResult | null) => void) => {
      const key = slotKey(v);
      const n = (seq.current.get(key) ?? 0) + 1;
      seq.current.set(key, n);
      setSaves((m) => new Map(m).set(key, seamReducer(m.get(key) ?? SEAM_IDLE, { kind: "tap", paired })));
      setStatus(sentence);
      const animate = !window.matchMedia(REDUCED_MOTION).matches;
      setDrawn((d) => {
        const next = new Set(d);
        if (paired && animate) next.add(key);
        else next.delete(key);
        return next;
      });
      void setSupersetPair({ date, sessionNo, rowA: v.rowA, rowB: v.rowB, paired })
        .catch(() => null)
        .then((result) => {
          if (seq.current.get(key) !== n) return;
          onResult?.(result);
          setSaves((m) => new Map(m).set(key, seamReducer(m.get(key) ?? { override: paired, status: "saving" }, { kind: "result", result })));
        });
    },
    [date, sessionNo],
  );

  const mark = useCallback<SupersetSaves["mark"]>((v, event, sentence) => {
    const key = slotKey(v);
    seq.current.set(key, (seq.current.get(key) ?? 0) + 1);
    if (sentence !== undefined) setStatus(sentence);
    if (event.kind === "clear") {
      setSaves((m) => {
        const next = new Map(m);
        next.delete(key);
        return next;
      });
      setDrawn((d) => {
        const next = new Set(d);
        next.delete(key);
        return next;
      });
      return;
    }
    if (event.kind === "tap") {
      setSaves((m) => new Map(m).set(key, seamReducer(m.get(key) ?? SEAM_IDLE, { kind: "tap", paired: true })));
      if (!window.matchMedia(REDUCED_MOTION).matches) setDrawn((d) => new Set(d).add(key));
      return;
    }
    setSaves((m) => new Map(m).set(key, seamReducer(m.get(key) ?? { override: true, status: "saving" }, event)));
  }, []);

  return { saves, pairs, ordered, drawn, status, toggle, mark };
}
