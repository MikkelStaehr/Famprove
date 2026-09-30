import Link from "next/link";

import type { WeekNav } from "@/lib/dashboard-view";
import { formatDateRange, formatWeekParam } from "@/lib/format";

/** Where a `?week=` value links. The value comes from weekly_load (WeekNav), never raw input. */
export function weekHref(param: string): string {
  return `/load?week=${param}`;
}

const STEP_CLASS =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-pill bg-track text-text";

/**
 * Previous / next ISO week as real links (server-rendered, no JS needed). When the card is
 * narrower than 20rem (200% text) the label takes its own row above the two steps instead of
 * squeezing between them. `scroll={false}`
 * keeps the scroll position and keyboard focus on the link: the default would jump to the top
 * of the page and move focus to the header when the header is off-screen.
 */
export function WeekSwitcher({ nav }: { readonly nav: WeekNav }) {
  const week = nav.selected;
  const shown = week.days.length;
  const note = shown >= 7 ? "" : ` · ${shown} af 7 dage ${nav.isLatest ? "indtil videre" : "med data"}`;
  return (
    <nav aria-label="Vælg uge" className="@container">
      <div className="grid grid-cols-2 items-center gap-2 @xs:grid-cols-[auto_minmax(0,1fr)_auto]">
        <span className="col-start-1 row-start-2 @xs:row-start-1">
          <Step target={nav.prev} direction="prev" year={week.isoYear} />
        </span>
        <p className="col-span-2 row-start-1 flex min-w-0 flex-col items-center text-center @xs:col-span-1 @xs:col-start-2">
          <span className="text-14 font-semibold tabular-nums">{formatDateRange(week.weekStart, week.weekEnd)}</span>
          <span className="text-14 text-text-muted tabular-nums">
            {nav.param}
            {note}
          </span>
        </p>
        <span className="col-start-2 row-start-2 justify-self-end @xs:col-start-3 @xs:row-start-1">
          <Step target={nav.next} direction="next" year={week.isoYear} />
        </span>
      </div>
    </nav>
  );
}

type StepProps = {
  readonly target: string | null;
  readonly direction: "prev" | "next";
  readonly year: number;
};

/** A 44px step link; at either end an empty box of the same size keeps the label centred. */
function Step({ target, direction, year }: StepProps) {
  if (target === null) return <span aria-hidden="true" className="block size-11 shrink-0" />;
  const label = `${direction === "prev" ? "Forrige" : "Næste"} uge: ${formatWeekParam(target, year)}`;
  return (
    <Link href={weekHref(target)} scroll={false} aria-label={label} className={STEP_CLASS}>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={direction === "prev" ? "M10 3 5 8l5 5" : "m6 3 5 5-5 5"} />
      </svg>
    </Link>
  );
}

/** Card action when looking back: one tap to the latest week. */
export function LatestWeekLink() {
  return (
    <Link
      href="/load"
      scroll={false}
      className="inline-flex min-h-11 items-center text-14 font-semibold text-text underline decoration-1 underline-offset-3"
    >
      Tilbage til denne uge
    </Link>
  );
}
