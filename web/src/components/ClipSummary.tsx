"use client";

/**
 * Optagelser's hidden overview (slice clip-summary): opened by a long-press on the card's title or
 * Shift+D on Træning with no player open. Plain mono lines from this phone's localStorage
 * (auto-last.ts), newest first, a count line and Kopiér alle. Local only: no fetch, no action.
 * Closed by Luk, the back gesture (its own history entry, like the player's) or unmount.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { AutoLast } from "@/lib/video/auto-last";
import { countLine, isSummaryEntry, SUMMARY_HISTORY_STATE, type SummaryClip, summaryLine, summaryText } from "@/lib/video/clip-summary";

const BTN = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const DARK_BTN = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-track px-4 font-sans text-14 font-medium text-text ${BTN}`;

export type SummaryItem = { readonly id: string; readonly clip: SummaryClip; readonly last: AutoLast | null };

export function ClipSummary({ items, onClose }: { readonly items: readonly SummaryItem[]; readonly onClose: () => void }) {
  const [copied, setCopied] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const text = useMemo(() => summaryText(items), [items]);

  useEffect(() => {
    heading.current?.focus();
    if (!isSummaryEntry(window.history.state)) window.history.pushState({ [SUMMARY_HISTORY_STATE]: true }, "");
    // The back gesture: closed once our entry is no longer on top (a player's entry popped above it keeps it open).
    const onPop = () => {
      if (!isSummaryEntry(window.history.state)) onClose();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onClose]);

  /** Luk: back over our entry when it is on top (its popstate closes), else close at once. */
  function close() {
    if (isSummaryEntry(window.history.state)) window.history.back();
    else onClose();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("Kopieret.");
    } catch {
      setCopied("Kunne ikke kopiere.");
    }
  }

  return (
    <section aria-labelledby="clip-summary-title" className="mt-3 flex flex-col gap-2 rounded-card border border-border bg-bg p-3">
      <div className="flex items-center justify-between">
        <h3 ref={heading} tabIndex={-1} id="clip-summary-title" className="font-mono text-13 uppercase tracking-wide text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          Oversigt
        </h3>
        <button type="button" className={`min-h-11 px-2 font-sans text-13 text-text underline underline-offset-4 ${BTN}`} onClick={close}>
          Luk
        </button>
      </div>
      {items.length === 0 ? (
        <p className="font-mono text-12 text-text-muted">Ingen optagelser.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((i) => (
            <li key={i.id} className="whitespace-pre-wrap break-words font-mono text-12 text-text tabular-nums">
              {summaryLine(i.clip, i.last)}
            </li>
          ))}
        </ul>
      )}
      <p className="whitespace-pre-wrap break-words font-mono text-12 text-text-muted tabular-nums">{countLine(items.map((i) => i.last))}</p>
      <div className="flex items-center gap-3">
        <button type="button" className={DARK_BTN} onClick={() => void copy()}>
          Kopiér alle
        </button>
        <span role="status" className="font-sans text-13 text-text-muted">
          {copied}
        </span>
      </div>
    </section>
  );
}
