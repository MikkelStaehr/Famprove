import type { ReactNode } from "react";

type SectionTitleProps = {
  /** The heading id; its section is labelled by it (unique on the page). */
  readonly id: string;
  /** 2 by default; 3 under a section h2 (Analyse's Cykel / Styrke). */
  readonly level?: 2 | 3;
  readonly className?: string;
  readonly children: ReactNode;
};

/** DESIGN.md SectionTitle: Geist 16/500, --text. */
export function SectionTitle({ id, level = 2, className, children }: SectionTitleProps) {
  const Heading = level === 3 ? "h3" : "h2";
  const cls = "font-sans text-16 font-medium text-text";
  return (
    <Heading id={id} className={className === undefined ? cls : `${cls} ${className}`}>
      {children}
    </Heading>
  );
}
