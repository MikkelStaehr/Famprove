import type { ReactNode } from "react";

type CardProps = {
  /** Heading id; the section is labelled by it. Must be unique on the page. */
  readonly id: string;
  readonly title: ReactNode;
  /** Optional control shown right of the title. */
  readonly action?: ReactNode;
  /**
   * "session": Today's cards (Part B: 32px Condensed 800 italic, uppercase via CSS).
   * "calm": /load's cards (20px Barlow 700, sentence case).
   * Omitted: the pre-Spurt look /load keeps until it is restyled.
   */
  readonly variant?: "session" | "calm";
  readonly children: ReactNode;
};

const TITLE = {
  session: "font-display text-32 leading-none font-extrabold uppercase italic",
  calm: "text-20 font-bold",
} as const;

/** DESIGN.md Card. Part B: --surface, light --shadow-card (dark: tone only), no border, 24/16 padding. */
export function Card({ id, title, action, variant, children }: CardProps) {
  if (variant === undefined) {
    return (
      <section
        aria-labelledby={id}
        className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={id} className="text-16 font-semibold">
            {title}
          </h2>
          {action}
        </div>
        {children}
      </section>
    );
  }
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-card bg-surface px-4 pt-6 pb-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className={TITLE[variant]}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
