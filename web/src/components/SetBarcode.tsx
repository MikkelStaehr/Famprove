"use client";

import { useSession } from "./SetLogProvider";

const FILL = { done: "bg-text", skipped: "bg-shade-2", open: "bg-track" } as const;

/**
 * The Sæt card's progress strip (reset-traening.md §2.5): one segment per set in session order,
 * 6px tall, 2px apart, --radius-cell (no 2px radius token). Done --text, skipped --shade-2, open --track. aria-hidden: the
 * set count and the week sentence say it. No motion.
 */
export function SetBarcode() {
  const segments = useSession().view.segments;
  return (
    <div aria-hidden="true" data-testid="set-barcode" className="flex h-1.5 w-full gap-0.5">
      {segments.map((state, i) => (
        <span key={i} data-state={state} className={`min-w-0 flex-1 rounded-cell ${FILL[state]}`} />
      ))}
    </div>
  );
}
