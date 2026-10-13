"use client";

import { headBarcode } from "@/lib/training-view";

import { useSession } from "./SetLogProvider";

const FILL = { done: "var(--text)", skipped: "var(--text-muted)", open: "var(--text-muted)" } as const;

/**
 * The strength section's head barcode (instrument-traening.md §2.1): one 2px tick per set by
 * position, done tall ink, skipped short muted, open a 4px stub at the baseline, +4px between
 * exercises. Geometry from training-view.headBarcode; aria-hidden (the count says it); no motion.
 */
export function SetBarcode() {
  const bars = useSession().view.bars;
  const code = headBarcode(bars);
  return (
    <svg
      aria-hidden="true"
      data-testid="set-barcode"
      width={code.width}
      height={code.height}
      viewBox={`0 0 ${code.width} ${code.height}`}
      preserveAspectRatio="xMinYMax meet"
      className="block max-w-full"
    >
      {code.ticks.map((t, i) => (
        <rect key={i} data-state={t.state} x={t.x} y={t.y} width={code.tickWidth} height={t.height} fill={FILL[t.state]} />
      ))}
    </svg>
  );
}
