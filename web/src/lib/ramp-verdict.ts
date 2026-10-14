/**
 * fitness-round.md §1: the fitness curve card's ramp text and verdict word. Pure, no I/O.
 *
 * The ramp itself is Python's (daily_load.ctl_ramp_7d, Hero.ctlRamp7d). The web only rounds it to
 * one decimal for display and classifies that rounded value against the thresholds below, so the
 * arrow, the number and the verdict always agree. These thresholds live here and nowhere else
 * (tests/ramp-verdict.test.ts checks that).
 */
import type { ZoneKey } from "./zone-scale.ts";

/** Below this (rounded) ramp a rise is healthy: 0 ≤ r < 5. */
export const RAMP_HARD_FROM = 5;
/** Up to and including this (rounded) ramp a rise is hard; above it, too fast: 5 ≤ r ≤ 8. */
export const RAMP_HARD_TO = 8;

export type RampVerdict = {
  readonly label: "Falder" | "Sund opbygning" | "Hård opbygning" | "For hurtigt";
  /** The zone whose colour the word takes (DESIGN.md zone colour rule): text only, never a pill. */
  readonly zone: ZoneKey;
};

/** One decimal, half away from zero (as Intl formats it), never −0: −0,04 → 0, 4,96 → 5, 8,06 → 8,1. */
export function roundRamp(ramp: number): number {
  const r = (Math.sign(ramp) * Math.round(Math.abs(ramp) * 10)) / 10;
  return r === 0 ? 0 : r;
}

/** The verdict on the ramp rounded to one decimal; null ramp → no verdict. */
export function rampVerdict(ramp: number | null): RampVerdict | null {
  if (ramp === null || !Number.isFinite(ramp)) return null; // never "For hurtigt" for a NaN
  const r = roundRamp(ramp);
  if (r < 0) return { label: "Falder", zone: "grey_zone" };
  if (r < RAMP_HARD_FROM) return { label: "Sund opbygning", zone: "optimal" };
  if (r <= RAMP_HARD_TO) return { label: "Hård opbygning", zone: "transition" };
  return { label: "For hurtigt", zone: "high_risk" };
}

const ONE_DECIMAL = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A value with one decimal and a Danish comma: 18.74 → "18,7". */
export function formatOneDecimal(value: number): string {
  return ONE_DECIMAL.format(roundRamp(value));
}

/**
 * The ramp beside the figure: "↑ 3,1 / 7 d" · "↓ 1,4 / 7 d" · "→ 0,0 / 7 d"; null → "– / 7 d".
 * The arrow comes from the rounded ramp, the number is its absolute value. `sr` words it for
 * screen readers.
 */
export function rampText(ramp: number | null): { readonly text: string; readonly sr: string } {
  if (ramp === null) return { text: "– / 7 d", sr: "Fitness-trenden kræver 7 dages data." };
  const r = roundRamp(ramp);
  const abs = ONE_DECIMAL.format(Math.abs(r));
  if (r > 0) return { text: `↑ ${abs} / 7 d`, sr: `Fitness steg ${abs} på 7 dage.` };
  if (r < 0) return { text: `↓ ${abs} / 7 d`, sr: `Fitness faldt ${abs} på 7 dage.` };
  return { text: `→ ${abs} / 7 d`, sr: "Fitness uændret over 7 dage." };
}
