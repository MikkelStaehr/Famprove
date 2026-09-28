import type { ReactNode } from "react";

type CardProps = {
  /** Heading id; the section is labelled by it. Must be unique on the page. */
  readonly id: string;
  readonly title: ReactNode;
  /** Optional control shown right of the title. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
};

/** DESIGN.md Card: --surface on --bg, 16px padding, 1px --border, radius 12, no shadow. */
export function Card({ id, title, action, children }: CardProps) {
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
