import type { ReactNode } from "react";

type CardProps = {
  /** Heading id; the section is labelled by it. Must be unique on the page. */
  readonly id: string;
  readonly title: ReactNode;
  /** Optional control shown right of the title. */
  readonly action?: ReactNode;
  /**
   * Kept for the callers; since Revision 5 both variants are the same section heading (Inter 400
   * text-20, sentence case). "session": Træning's sections; "calm": /load's and /analyse's.
   */
  readonly variant: "session" | "calm";
  /** Heading level; 3 under a section h2 (/analyse "Cykel"). Default 2. */
  readonly level?: 2 | 3;
  /** Extra classes on the section, e.g. desktop grid placement (`lg:col-span-8`). */
  readonly className?: string;
  readonly children: ReactNode;
};

const TITLE = {
  session: "font-sans text-20 font-normal",
  calm: "font-sans text-20 font-normal",
} as const;

/**
 * DESIGN.md Card, a section since Part B Revision 5: heading, 8px, a 1px --border hairline, 16px,
 * content. No fill, radius 0, no shadow; the screens space sections 40px apart.
 */
export function Card({ id, title, action, variant, level = 2, className, children }: CardProps) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section aria-labelledby={id} className={`flex flex-col gap-3${className === undefined ? "" : ` ${className}`}`}>
      {/* pb-2 = 8px to the hairline; mb-1 + the section's gap-3 = 16px to the content. */}
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border pb-2">
        <Heading id={id} className={TITLE[variant]}>
          {title}
        </Heading>
        {action}
      </div>
      {children}
    </section>
  );
}
