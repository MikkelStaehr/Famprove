import Link from "next/link";

import type { ReactNode } from "react";

import type { WeekNav } from "@/lib/dashboard-view";
import { formatWeekParam } from "@/lib/format";

import { Icon } from "./icons";

/** Where a `?week=` value links. The value comes from weekly_load (WeekNav), never raw input. */
export function weekHref(param: string): string {
  return `/load?week=${param}`;
}

/** Ember secondary button: 44px, 1px --text-muted border, --radius-button, Geist 14/500, chevron 16. */
const STEP_CLASS =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-button border border-text-muted px-3 font-sans text-14 font-medium text-text active:opacity-85";

/**
 * reset-belastning.md §6 switcher: `‹ Uge 41` left, `Uge 43 ›` right, real links (server-rendered,
 * no JS). At either end the button is absent and an empty 44px box keeps the layout; `latest` (the
 * "Tilbage til denne uge" link) sits centred between them. `scroll={false}` keeps scroll and focus.
 */
export function WeekSwitcher({ nav, latest }: { readonly nav: WeekNav; readonly latest?: ReactNode }) {
  const year = nav.selected.isoYear;
  return (
    <nav aria-label="Vælg uge" className="flex flex-wrap items-center justify-between gap-2">
      <Step target={nav.prev} direction="prev" year={year} />
      {latest}
      <Step target={nav.next} direction="next" year={year} />
    </nav>
  );
}

type StepProps = {
  readonly target: string | null;
  readonly direction: "prev" | "next";
  readonly year: number;
};

function Step({ target, direction, year }: StepProps) {
  if (target === null) return <span aria-hidden="true" className="block size-11 shrink-0" />;
  const week = formatWeekParam(target, year);
  const n = target.slice(target.indexOf("W") + 1).replace(/^0/, "");
  return (
    <Link href={weekHref(target)} scroll={false} aria-label={`Gå til ${week}`} className={STEP_CLASS}>
      {direction === "prev" && <Icon name="chevron-left" size={16} />}
      Uge {n}
      {direction === "next" && <Icon name="chevron-right" size={16} />}
    </Link>
  );
}

/** Card action when looking back: one tap to the latest week. */
export function LatestWeekLink() {
  return (
    <Link
      href="/load"
      scroll={false}
      className="inline-flex min-h-11 items-center font-sans text-14 font-medium text-text underline decoration-1 underline-offset-3"
    >
      Tilbage til denne uge
    </Link>
  );
}
