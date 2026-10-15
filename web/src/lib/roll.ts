/**
 * Rolling digits (slice motion-numbers, spec design/specs/motion-numbers-icons.md; reference
 * famprove-motion.html `setRoll`). Pure: which characters of a formatted value roll, and when.
 * RollingNumber renders the plan; this file decides it.
 */
import { DUR } from "./motion.ts";

/** One character of the new text: a digit column (0–9) or a plain character that swaps at once. */
export type RollCell =
  | {
      readonly kind: "digit";
      /** The digit the column starts on (equals `to` when nothing rolls). */
      readonly from: number;
      readonly to: number;
      /** True when this column moves. */
      readonly rolls: boolean;
      /** DUR.rollStagger × this digit's index among digits (non-digits do not count). */
      readonly delayMs: number;
    }
  | { readonly kind: "char"; readonly char: string };

export type RollPlan = {
  /** False on a structure change (length or a digit ↔ non-digit position): show `to`, no roll. */
  readonly rolls: boolean;
  readonly cells: readonly RollCell[];
};

const isDigit = (c: string): boolean => c >= "0" && c <= "9" && c.length === 1;

/** Same length and every position a digit in both or a non-digit in both. */
export function sameShape(from: string, to: string): boolean {
  const a = Array.from(from);
  const b = Array.from(to);
  return a.length === b.length && a.every((c, i) => isDigit(c) === isDigit(b[i]));
}

/** The plan for showing `to` after `from`. Characters are code points ("−" is one). */
export function rollPlan(from: string, to: string): RollPlan {
  const a = Array.from(from);
  const shape = sameShape(from, to);
  let k = 0;
  const cells = Array.from(to).map((c, i): RollCell => {
    if (!isDigit(c)) return { kind: "char", char: c };
    const target = Number(c);
    const start = shape ? Number(a[i]) : target;
    const delayMs = shape ? k * DUR.rollStagger : 0;
    k += 1;
    return { kind: "digit", from: start, to: target, rolls: start !== target, delayMs };
  });
  return { rolls: cells.some((c) => c.kind === "digit" && c.rolls), cells };
}

/** A key for the plan's structure: a new shape remounts the columns (no transition from old ones). */
export function shapeKey(text: string): string {
  return Array.from(text, (c) => (isDigit(c) ? "d" : "c")).join("");
}
