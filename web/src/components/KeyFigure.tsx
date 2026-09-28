import type { ReactNode } from "react";

export type Direction = "up" | "down" | "flat";

export type Delta = {
  /** null: no trend available yet (text explains why). */
  readonly direction: Direction | null;
  readonly text: string;
};

type KeyFigureProps = {
  /** Heading id; the hero section is labelled by it. */
  readonly id: string;
  readonly label: string;
  /** e.g. the date the value belongs to. */
  readonly context?: string;
  /** Pre-formatted value (the UI never calculates it). */
  readonly value: string;
  readonly unit: string;
  /** Usually a StatusBadge: the one-line status. */
  readonly status?: ReactNode;
  readonly delta?: Delta;
  readonly detail?: ReactNode;
};

/** DESIGN.md KeyFigure: the largest element on the screen (40px number). */
export function KeyFigure({ id, label, context, value, unit, status, delta, detail }: KeyFigureProps) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-14 text-text-muted">
        <span className="font-semibold text-text">{label}</span>
        {context !== undefined && <> · {context}</>}
      </h2>
      <p className="flex items-baseline gap-2">
        <span className="text-40 font-bold tabular-nums">{value}</span>
        <span className="text-14 text-text-muted">{unit}</span>
      </p>
      {(status !== undefined || delta !== undefined) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {status}
          {delta !== undefined && (
            <p className="inline-flex items-center gap-1 text-14">
              {delta.direction !== null && <DirectionIcon direction={delta.direction} />}
              {delta.text}
            </p>
          )}
        </div>
      )}
      {detail !== undefined && <p className="text-14 text-text-muted">{detail}</p>}
    </section>
  );
}

/** Arrow for the delta; decorative because the text states the direction in words. */
function DirectionIcon({ direction }: { readonly direction: Direction }) {
  const d =
    direction === "up" ? "M8 3v10M4 7l4-4 4 4" : direction === "down" ? "M8 13V3M4 9l4 4 4-4" : "M3 8h10M9 4l4 4-4 4";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
