import type { ReactNode } from "react";

import {
  ArrowDown,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Bike,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  History,
  ChevronRight,
  type LucideIcon,
  Minus,
  Play,
  Plus,
  RotateCw,
  Share2,
  Star,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

/**
 * DESIGN.md Part B "Icons" (slice motion-icons): the one place that imports `lucide-react`, a
 * name → icon map, so call sites use `<Icon name=…>`. 24 viewBox, no fill, currentColor,
 * stroke 1.5 scaled with size (not absoluteStrokeWidth), round caps and joins. Decorative by
 * default (aria-hidden): the text next to an icon carries the meaning, and an icon-only button
 * names itself with aria-label.
 * The three tab icons are own paths, so their parts can animate (TabBar adds `.icon-play`; the
 * keyframes live in globals.css): barbell's group lifts, trend's line draws (pathLength 1), bars'
 * three bars grow from the baseline. Everywhere else they render the same, without motion.
 */
export type IconName =
  | "barbell"
  | "bike"
  | "trend"
  | "bars"
  | "arrow-right"
  | "arrow-left-right"
  | "arrow-up-right"
  | "arrow-down-right"
  | "chevron-left"
  | "history"
  | "chevron-right"
  | "chevron-down"
  | "chevron-up"
  | "warning"
  | "check"
  | "arrow-up"
  | "arrow-down"
  | "arrow-flat"
  | "x"
  | "minus"
  | "plus"
  | "refresh"
  | "play"
  | "star"
  | "share"
  | "trash";

/** Part B sizes: 22 phone tab bar, 20 desktop tabs / card corners / icon buttons, 18 ListRow, 16 WarningLine and chevrons. */
export type IconSize = 16 | 18 | 20 | 22;

type OwnName = "barbell" | "trend" | "bars";

/** The tab icons' own paths (Part B "Icons"); class names are the animation hooks in globals.css. */
const OWN: Readonly<Record<OwnName, ReactNode>> = {
  barbell: (
    <g className="i-dumb">
      <path d="M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12" />
    </g>
  ),
  trend: <path className="i-line" pathLength={1} d="M3 17l5-6 4 3 4-7 5 5" />,
  bars: (
    <>
      <g>
        <path className="i-b" d="M5 20V11" />
        <path className="i-b" d="M11 20V5" />
        <path className="i-b" d="M17 20v-7" />
      </g>
      <path d="M2.5 20.5h19" />
    </>
  ),
};

/** The Lucide map (Part B "Icons"). arrow-up-right / arrow-down-right: Analyse › Cykel's answer arrows (↗ ↘). */
const LUCIDE: Readonly<Record<Exclude<IconName, OwnName>, LucideIcon>> = {
  bike: Bike,
  "arrow-right": ArrowRight,
  "arrow-left-right": ArrowLeftRight,
  "arrow-up-right": ArrowUpRight,
  "arrow-down-right": ArrowDownRight,
  "chevron-left": ChevronLeft,
  history: History,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  warning: TriangleAlert,
  check: Check,
  "arrow-up": ArrowUp,
  "arrow-down": ArrowDown,
  "arrow-flat": ArrowRight,
  x: X,
  minus: Minus,
  plus: Plus,
  refresh: RotateCw,
  play: Play,
  star: Star,
  share: Share2,
  trash: Trash2,
};

const STROKE = 1.5;

function isOwn(name: IconName): name is OwnName {
  return name === "barbell" || name === "trend" || name === "bars";
}

type IconProps = {
  readonly name: IconName;
  readonly size?: IconSize;
  readonly className?: string;
  /** Star on (Part B: the one filled icon). */
  readonly filled?: boolean;
};

export function Icon({ name, size = 18, className, filled = false }: IconProps) {
  const cls = className === undefined ? "shrink-0" : `shrink-0 ${className}`;
  if (isOwn(name)) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={cls}
      >
        {OWN[name]}
      </svg>
    );
  }
  const Lucide = LUCIDE[name];
  return <Lucide size={size} strokeWidth={STROKE} fill={filled ? "currentColor" : "none"} aria-hidden="true" focusable="false" className={cls} />;
}
