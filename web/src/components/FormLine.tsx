import Link from "next/link";

import type { IsoDate } from "@/lib/db/rows";
import { formatDay, formatSigned, TSS_PER_DAY } from "@/lib/format";
import type { TodayHeader } from "@/lib/today-view";

import { StatusBadge } from "./StatusBadge";

type FormLineProps = {
  /** null: no daily_load rows yet. */
  readonly header: TodayHeader | null;
  readonly today: IsoDate;
};

/**
 * Today's one load number: "Form (TSB) +11 TSS/day [zone]". When the latest daily_load row is
 * older than today, its date follows the unit so nobody takes an old number for today's.
 */
export function FormLine({ header, today }: FormLineProps) {
  if (header === null) {
    return (
      <p className="text-14 text-text-muted">
        Form not computed yet. The daily job fills it at about 05:00.
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-14 font-semibold">Form (TSB)</span>
      <span className="text-20 font-bold tabular-nums">{formatSigned(header.tsb)}</span>
      <span className="text-14 text-text-muted">
        {TSS_PER_DAY}
        {header.date !== today && (
          <>
            {" · "}
            <time dateTime={header.date}>{formatDay(header.date)}</time>
          </>
        )}
      </span>
      {header.zone === null ? (
        <StatusBadge tone="neutral" label="Zone not computed" />
      ) : (
        <StatusBadge tone={header.zone.tone} label={header.zone.label} />
      )}
    </p>
  );
}

/**
 * The form read failed; the plan still renders. "Try again" is a soft navigation to "/": it
 * re-reads the (request-time) page and, unlike a reload, keeps the ticks.
 */
export function FormLineError() {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-14 text-warning">
      <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 shrink-0" fill="currentColor">
        <path d="M6 1 11 11H1Z" />
      </svg>
      <span>Couldn&apos;t load form (TSB).</span>
      {/* Underlined: inside a sentence the link must not differ by colour alone. */}
      <Link
        href="/"
        prefetch={false}
        className="inline-flex min-h-11 items-center font-semibold text-accent underline"
      >
        Try again
      </Link>
    </p>
  );
}
