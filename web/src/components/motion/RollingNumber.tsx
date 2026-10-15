"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { DUR, EASE_EMBER, REDUCED_MOTION } from "@/lib/motion";
import { type RollPlan, rollPlan, shapeKey } from "@/lib/roll";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

const at = (d: number): string => `translateY(${-d}lh)`;

/**
 * Every cell is exactly one line (`1lh`, the inherited line height) and the line height is left
 * alone, so the plain first paint and the rolling columns take the same line box: no layout shift
 * (spec N3; a 1.1em cell had moved /load by 1 px).
 */
const WRAP = "inline-flex whitespace-nowrap tabular-nums";
const CELL = "block h-[1lh]";

/**
 * A formatted number whose changed digits roll (DESIGN.md Part B "Motion", spec
 * motion-numbers-icons.md N1–N6). Server render and first paint are the plain text; only a change
 * after mount builds the digit columns. A shape change (9 → 10) shows the new text with no roll;
 * reduced motion changes it in place. Styling (size, weight, colour) comes from the parent.
 */
export function RollingNumber({ text }: { readonly text: string }) {
  const [shown, setShown] = useState<{ readonly text: string; readonly plan: RollPlan | null }>({ text, plan: null });
  if (shown.text !== text) setShown({ text, plan: rollPlan(shown.text, text) });
  const columns = useRef<(HTMLSpanElement | null)[]>([]);

  useLayoutEffect(() => {
    const { plan } = shown;
    if (plan === null) return;
    const animate = plan.rolls && !window.matchMedia(REDUCED_MOTION).matches;
    plan.cells.forEach((cell, i) => {
      const el = columns.current[i];
      if (cell.kind !== "digit" || el === null || el === undefined) return;
      const target = at(cell.to);
      if (!animate || !cell.rolls) {
        if (el.style.transform !== target) {
          el.style.transition = "none";
          el.style.transform = target;
        }
        return;
      }
      if (el.style.transform === "") {
        // Freshly built column: park it on the old digit before the transition starts.
        el.style.transition = "none";
        el.style.transform = at(cell.from);
        void el.offsetWidth;
      }
      el.style.willChange = "transform"; // only while it rolls
      el.addEventListener("transitionend", () => (el.style.willChange = ""), { once: true });
      el.style.transition = `transform ${DUR.roll}ms ${EASE_EMBER} ${cell.delayMs}ms`;
      el.style.transform = target;
    });
  }, [shown]);

  if (shown.plan === null) {
    return (
      <span className={WRAP}>
        <span className={CELL}>{text}</span>
      </span>
    );
  }
  return (
    <span className={WRAP}>
      <span className="sr-only">{shown.text}</span>
      <span key={shapeKey(shown.text)} aria-hidden="true" className="inline-flex">
        {shown.plan.cells.map((cell, i) =>
          cell.kind === "digit" ? (
            <span key={i} className={`${CELL} overflow-clip`}>
              <span
                ref={(el) => {
                  columns.current[i] = el;
                }}
                className="block"
              >
                {DIGITS.map((d) => (
                  <span key={d} className={CELL}>
                    {d}
                  </span>
                ))}
              </span>
            </span>
          ) : (
            <span key={i} className={`${CELL} whitespace-pre`}>
              {cell.char}
            </span>
          ),
        )}
      </span>
    </span>
  );
}
