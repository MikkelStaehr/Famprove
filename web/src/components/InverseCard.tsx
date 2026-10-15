import Link from "next/link";
import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/icons";

type InverseCardProps = {
  /** Heading id; the section is labelled by the title. */
  readonly id: string;
  /** Mono caption, written as a label (shown uppercase): `I dag`. */
  readonly caption: string;
  /** 20px icon right of the caption. */
  readonly icon?: IconName;
  readonly title: ReactNode;
  /** One supporting line, text-13 --inverse-muted. */
  readonly line?: ReactNode;
  /** The primary action: an InverseButton (or nothing). */
  readonly children?: ReactNode;
  readonly className?: string;
};

/**
 * DESIGN.md InverseCard (Træning's "I dag"): the one light surface on a screen. --inverse-bg, no
 * border, --radius-half, padding 18px, gap 12px. --today never appears on it (2.91:1); its focus
 * ring is --inverse-text (`on-inverse`, globals.css).
 */
export function InverseCard({ id, caption, icon, title, line, children, className }: InverseCardProps) {
  return (
    <section
      aria-labelledby={id}
      className={`on-inverse flex flex-col gap-3 rounded-half bg-inverse-bg p-4.5 text-inverse-text${className === undefined ? "" : ` ${className}`}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-11 text-inverse-muted uppercase">{caption}</span>
        {icon === undefined ? null : <Icon name={icon} size={20} className="text-inverse-text" />}
      </div>
      <h2 id={id} className="font-sans text-20 font-semibold text-inverse-text">
        {title}
      </h2>
      {line === undefined ? null : <p className="font-sans text-13 text-inverse-muted">{line}</p>}
      {children}
    </section>
  );
}

/** The InverseCard's dark 48px button (Part B Buttons): full width, --radius-button, --inverse-text fill, 1px --text-muted border, --text `text-button` label, trailing 18px arrow. */
export const INVERSE_BUTTON =
  "mt-1 flex min-h-12 w-full items-center justify-center gap-2 rounded-button border border-text-muted bg-inverse-text px-4 text-button text-text active:opacity-85";

export function InverseButton({ href, label }: { readonly href: string; readonly label: string }) {
  return (
    <Link href={href} className={INVERSE_BUTTON}>
      {label}
      <Icon name="arrow-right" size={18} />
    </Link>
  );
}
