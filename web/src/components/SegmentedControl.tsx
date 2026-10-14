"use client";

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
 */
export function SegmentedControl<T extends string>({ label, segments, value, onChange, size = "default", className }: SegmentedControlProps<T>) {
  const pad = size === "hero" ? "px-2.5 py-1.75" : "px-2.25 py-1.5";
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex gap-0.5 rounded-control border border-border bg-bg p-0.75 font-mono text-12${className === undefined ? "" : ` ${className}`}`}
    >
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
              selected ? "bg-raised font-medium text-text" : "bg-transparent font-normal text-text-muted"
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
