import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/icons";

type ListRowProps = {
  /** The day column (36px, Geist Mono text-12): `Man`, `Tir`. */
  readonly day?: ReactNode;
  /** Today's day reads --text instead of --text-muted. */
  readonly today?: boolean;
  readonly icon?: IconName;
  /** The icon is --text when done, else --text-muted. */
  readonly done?: boolean;
  /** --text-muted text for rest or missing. */
  readonly muted?: boolean;
  /** Right-aligned value, Geist Mono text-14. */
  readonly value?: ReactNode;
  readonly as?: "div" | "li";
  readonly className?: string;
  readonly children: ReactNode;
};

/** DESIGN.md ListRow: day | icon | text | value; gap 12px, padding 10px 0, 1px --border top border. */
export function ListRow({ day, today = false, icon, done = false, muted = false, value, as: Tag = "div", className, children }: ListRowProps) {
  return (
    <Tag className={`flex items-center gap-3 border-t border-border py-2.5${className === undefined ? "" : ` ${className}`}`}>
      {day === undefined ? null : (
        <span className={`w-9 shrink-0 font-mono text-12 ${today ? "text-text" : "text-text-muted"}`}>{day}</span>
      )}
      {icon === undefined ? null : <Icon name={icon} size={18} className={done ? "text-text" : "text-text-muted"} />}
      <span className={`min-w-0 flex-1 font-sans text-14 ${muted ? "text-text-muted" : "text-text"}`}>{children}</span>
      {value === undefined ? null : <span className="shrink-0 text-right font-mono text-14 text-text tabular-nums">{value}</span>}
    </Tag>
  );
}
