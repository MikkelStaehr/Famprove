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
   */
  readonly variant: "session" | "calm";
  /** Heading level; 3 under a section h2 (/analyse "Cykel"). Default 2. */
  readonly level?: 2 | 3;
  readonly children: ReactNode;
};

const TITLE = {
  session: "font-display text-32 leading-none font-extrabold uppercase italic",
  calm: "text-20 font-bold",
} as const;

/** DESIGN.md Card. Part B: --surface, light --shadow-card (dark: tone only), no border, 24/16 padding. */
export function Card({ id, title, action, variant, level = 2, children }: CardProps) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-card bg-surface px-4 pt-6 pb-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Heading id={id} className={TITLE[variant]}>
          {title}
        </Heading>
        {action}
      </div>
      {children}
    </section>
  );
}
