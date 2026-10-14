import type { ReactNode } from "react";

/**
 * Every line icon DESIGN.md Part B "Icons" lists, in one file: 24 viewBox, no fill, currentColor,
 * 1.5px stroke, butt caps as drawn. Decorative by default (aria-hidden): the text next to an icon
 * carries the meaning, and an icon-only button names itself with aria-label.
 */
export type IconName =
  | "barbell"
  | "bike"
  | "trend"
  | "bars"
  | "arrow-right"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "warning"
  | "check"
  | "arrow-up"
  | "arrow-down"
  | "arrow-flat";

/** Part B sizes: 22 phone tab bar, 20 desktop tabs / card corners / icon buttons, 18 ListRow, 16 WarningLine and chevrons. */
export type IconSize = 16 | 18 | 20 | 22;

const PATHS: Readonly<Record<IconName, ReactNode>> = {
  barbell: <path d="M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12" />,
  bike: (
    <>
      <circle cx="6" cy="16" r="4" />
      <circle cx="18" cy="16" r="4" />
      <path d="M6 16l4-8h5l3 8M10 8l3 8" />
    </>
  ),
  trend: <path d="M3 17l5-6 4 3 4-7 5 5" />,
  bars: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
  "chevron-left": <path d="M15 6l-6 6 6 6" />,
  "chevron-right": <path d="M9 6l6 6-6 6" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  warning: <path d="M12 4l9 16H3zM12 10v4M12 17v.5" />,
  check: <path d="M5 12l5 5 9-10" />,
  "arrow-up": <path d="M12 19V5M6 11l6-6 6 6" />,
  "arrow-down": <path d="M12 5v14M6 13l6 6 6-6" />,
  "arrow-flat": <path d="M5 12h14M13 6l6 6-6 6" />,
};

type IconProps = {
  readonly name: IconName;
  readonly size?: IconSize;
  readonly className?: string;
};

export function Icon({ name, size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      focusable="false"
      className={className === undefined ? "shrink-0" : `shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}
