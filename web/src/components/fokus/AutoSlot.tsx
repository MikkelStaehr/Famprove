import { fokusAutoLine } from "@/lib/video/auto-lines";
import type { AutoSlot as Slot } from "./useClipRecorder";

/**
 * clip-auto §1: the rest card's last row after a recorded set. Two lines (2 × 18 px) reserved from
 * Stop, top-aligned, so the card's box never changes; Geist 13 muted, the figure in Geist Mono
 * tabular. The visible line is hidden from screen readers; the status region says the start once
 * and the outcome once (`spoken`), never the %.
 */
export function AutoSlot({ slot }: { readonly slot: Slot }) {
  const line = slot.phase === null ? null : fokusAutoLine(slot.phase);
  return (
    <div className="mt-auto pt-3">
      <p aria-hidden="true" className="h-[2lh] overflow-hidden font-sans text-13 text-text-muted">
        {line !== null && (
          <>
            {line.words}
            {line.figure !== null && <span className="font-mono tabular-nums"> {line.figure}</span>}
          </>
        )}
      </p>
      <p role="status" className="sr-only">
        {slot.spoken}
      </p>
    </div>
  );
}
