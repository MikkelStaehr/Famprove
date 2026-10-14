import type { ReactNode } from "react";

type MonoCaptionProps = {
  /** 12 = card captions, date ranges, the updated line, ListRow day; 11 = tile labels, legends, axis labels, I DAG. */
  readonly size?: 11 | 12;
  /** Labels are uppercase (`FORM I DAG`); values in a caption slot (date ranges, `12 uger`) stay as written. */
  readonly uppercase?: boolean;
  readonly as?: "span" | "p" | "div";
  readonly className?: string;
  readonly children: ReactNode;
};

/** DESIGN.md MonoCaption: Geist Mono 11–12, --text-muted, no letter-spacing. */
export function MonoCaption({ size = 12, uppercase = true, as: Tag = "span", className, children }: MonoCaptionProps) {
  const cls = `font-mono font-normal text-text-muted ${size === 11 ? "text-11" : "text-12"}${uppercase ? " uppercase" : ""}`;
  return <Tag className={className === undefined ? cls : `${cls} ${className}`}>{children}</Tag>;
}
