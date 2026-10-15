"use client";

import { useLayoutEffect, useRef } from "react";

export type Segment<T extends string> = {
  readonly value: T;
  readonly label: string;
  /** Spoken name when the label is an abbreviation (`3M` → `3 måneder`). */
  readonly ariaLabel?: string;
};

type SegmentedControlProps<T extends string> = {
  /** The group's accessible name, e.g. `Periode`. */
  readonly label: string;
  readonly segments: readonly Segment<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  /** `hero`: the larger segment padding (7px 10px) on a hero card. */
  readonly size?: "default" | "hero";
  readonly className?: string;
};

/**
 * DESIGN.md SegmentedControl (Part B Ember): real <button>s with aria-pressed in a role="group".
 * Track --bg, 1px --border, --radius-control, padding 3px, gap 2px, Geist Mono text-12. Selected:
 * --raised fill, --text, weight 500; others transparent, --text-muted, 400 (weight + fill, never
 * colour alone). Each segment's hit area is ≥ 44 × 44 through the hit-44 ::before.
 * The --raised fill is one pill that slides under the selected segment (DESIGN.md Motion, 350 ms
 * --ease-ember; the reference's `.seg .pill`); placed without a transition the first time, snapped
 * under reduced motion. Before it is placed (server render) the selected button carries the fill.
 */
export function SegmentedControl<T extends string>({ label, segments, value, onChange, size = "default", className }: SegmentedControlProps<T>) {
  const pad = size === "hero" ? "px-2.5 py-1.75" : "px-2.25 py-1.5";
  const group = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  // The reference's placePill(): under the selected button, on every change and every resize.
  useLayoutEffect(() => {
    const g = group.current;
    const p = pill.current;
    if (g === null || p === null) return;
    const place = () => {
      const b = g.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (b === null) return;
      p.style.width = `${b.offsetWidth}px`;
      p.style.transform = `translateX(${b.offsetLeft}px)`;
      if (g.dataset.pill === undefined) {
        void p.offsetWidth; // the first placement lands without sliding
        g.dataset.pill = "";
      }
    };
    place();
    // A resize, a late font swap or text zoom re-places the pill without sliding; only a value slides.
    const observer = new ResizeObserver(() => {
      p.style.transition = "none";
      place();
      void p.offsetWidth;
      p.style.transition = "";
    });
    observer.observe(g);
    return () => observer.disconnect();
  }, [value]);
  return (
    <div
      ref={group}
      role="group"
      aria-label={label}
      className={`group relative inline-flex gap-0.5 rounded-control border border-border bg-bg p-0.75 font-mono text-12${className === undefined ? "" : ` ${className}`}`}
    >
      <span
        ref={pill}
        aria-hidden="true"
        className="invisible absolute top-0.75 bottom-0.75 left-0 rounded-segment bg-raised group-data-pill:visible group-data-pill:transition-[transform,width] group-data-pill:duration-350 group-data-pill:ease-(--ease-ember) motion-reduce:transition-none!"
      />
      {segments.map((s) => {
        const selected = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={selected}
            aria-label={s.ariaLabel}
            onClick={() => onChange(s.value)}
            className={`hit-44 rounded-segment ${pad} transition-colors duration-[120ms] ease-out ${
              selected ? "bg-raised font-medium text-text group-data-pill:bg-transparent" : "bg-transparent font-normal text-text-muted"
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
