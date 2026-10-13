"use client";

import { useCallback, useState } from "react";

import { BARCODE, dayBarcode } from "@/lib/day-barcode";

/**
 * A day row's barcode (instrument-load.md §4): decorative (aria-hidden), the row's sr text
 * carries the values. Measures its own width so overflow is marked, never clipped silently.
 */
export function DayBarcode({ cycling, strength }: { readonly cycling: number | null; readonly strength: number | null }) {
  const [width, setWidth] = useState<number | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (el === null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const g = width === null ? null : dayBarcode(cycling, strength, width);
  const h = BARCODE.height.cycling;
  return (
    <div ref={measure} aria-hidden="true" className="h-4 w-full min-w-12">
      {g !== null && width !== null && (
        <svg width={width} height={h} className="block">
          {g.ticks.map((t) => (
            <rect key={`${t.part}-${t.x}`} x={t.x} y={h - t.h} width={BARCODE.tick} height={t.h} fill="var(--text)" />
          ))}
          {g.endBarX !== null && <rect x={g.endBarX} y={0} width={BARCODE.endBar} height={h} fill="var(--text)" />}
        </svg>
      )}
    </div>
  );
}
