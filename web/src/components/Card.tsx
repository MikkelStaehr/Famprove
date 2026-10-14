import type { ReactNode } from "react";

import { SectionTitle } from "@/components/SectionTitle";

type CardProps = {
  /** Heading id; the section is labelled by it. Must be unique on the page. */
  readonly id: string;
  readonly title: ReactNode;
  /** Right of the title: a MonoCaption (text-12) or a control. */
  readonly action?: ReactNode;
  /** Retired with Instrument; ignored. The reset runs drop it from their callers. */
  readonly variant?: "session" | "calm";
  /** Heading level; 3 under a section h2 (Analyse's Cykel / Styrke). Default 2. */
  readonly level?: 2 | 3;
  /** Shape: `card` (section card, 22px, padding 18), `hero` (26px, padding 22 20 16), `half` (20px, padding 16). */
  readonly shape?: "card" | "hero" | "half";
  /** Extra classes on the section, e.g. desktop grid placement (`lg:col-span-2`). */
  readonly className?: string;
  readonly children: ReactNode;
};

const SHAPE = {
  card: "rounded-card p-4.5",
  hero: "rounded-hero px-5 pt-5.5 pb-4",
  half: "rounded-half p-4",
} as const;

/**
 * DESIGN.md Card (Part B Ember): a <section aria-labelledby>, --card fill, 1px --border, no shadow,
 * column gap 14px. Header row: SectionTitle left, MonoCaption or a control right.
 */
export function Card({ id, title, action, level = 2, shape = "card", className, children }: CardProps) {
  return (
    <section
      aria-labelledby={id}
      className={`flex min-w-0 flex-col gap-3.5 border border-border bg-card ${SHAPE[shape]}${className === undefined ? "" : ` ${className}`}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <SectionTitle id={id} level={level}>
          {title}
        </SectionTitle>
        {action}
      </div>
      {children}
    </section>
  );
}
