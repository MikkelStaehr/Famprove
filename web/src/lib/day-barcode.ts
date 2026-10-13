/**
 * The week card's day barcode (design/specs/instrument-load.md §4): one tick per 10 TSS,
 * n = round(tss / 10) per part, pitch 3px, tick 1px. Cycling ticks 1×16, then (after a 4px gap)
 * strength ticks 1×8. Ticks that don't fit stop, and a 1×16 end bar 2px after the last one marks
 * the overflow. Pure geometry in px; the values are the day's TSS as stored (Python's).
 */
export const BARCODE = {
  perTick: 10,
  pitch: 3,
  tick: 1,
  height: { cycling: 16, strength: 8 },
  partGap: 4,
  endBar: 1,
  endGap: 2,
} as const;

export type BarcodePart = "cycling" | "strength";

export type BarcodeTick = { readonly x: number; readonly h: number; readonly part: BarcodePart };

export type DayBarcodeGeometry = {
  readonly ticks: readonly BarcodeTick[];
  /** The overflow end bar's x (1×16), or null when every tick fits. */
  readonly endBarX: number | null;
};

/** Ticks for one part: round(tss / 10); null, non-finite or ≤ 0 draws nothing (missing is not 0 ticks of data). */
export function tickCount(tss: number | null): number {
  if (tss === null || !Number.isFinite(tss) || tss <= 0) return 0;
  return Math.round(tss / BARCODE.perTick);
}

/** The ticks that fit in `width` px, cycling first, then strength after the part gap. */
export function dayBarcode(cycling: number | null, strength: number | null, width: number): DayBarcodeGeometry {
  const b = BARCODE;
  const nC = tickCount(cycling);
  const nS = tickCount(strength);
  const ticks: BarcodeTick[] = [];
  for (let i = 0; i < nC; i += 1) ticks.push({ x: i * b.pitch, h: b.height.cycling, part: "cycling" });
  const strengthStart = nC > 0 ? (nC - 1) * b.pitch + b.tick + b.partGap : 0;
  for (let j = 0; j < nS; j += 1) ticks.push({ x: strengthStart + j * b.pitch, h: b.height.strength, part: "strength" });
  const last = ticks.at(-1);
  if (last === undefined || last.x + b.tick <= width) return { ticks, endBarX: null };
  const endBarX = Math.max(0, width - b.endBar);
  return { ticks: ticks.filter((t) => t.x + b.tick <= endBarX - b.endGap), endBarX };
}
