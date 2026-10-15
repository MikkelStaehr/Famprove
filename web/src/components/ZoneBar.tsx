import Link from "next/link";
import { FORM_ZONE_DISPLAY } from "@/lib/dashboard-view";
import { BANDS, pinned, position, ZONE_CLASS, type ZoneKey } from "@/lib/zone-scale";

const pct = (x: number) => `${(x * 100).toFixed(4)}%`;

/**
 * DESIGN.md Part B (Ember) ZoneBar: five segments on the zone scale (−40 … +30 TSS/dag, true widths
 * 10/20/15/15/10), 8px tall, 3px apart, outer ends rounded 4px. The active segment (Python's
 * form_zone, never derived from TSB) is its zone colour; the others at 30 % (decorative). Today's TSB
 * is a 2 × 14 --text tick (off the scale: pinned to the end with an outward chevron). The zone words
 * sit under the segments, the active one in its colour, weight 500. Decorative: the form card's sr
 * sentence (zoneSentence) carries all of it.
 */
type ZoneBarProps = {
  /** daily_load.tsb; null = no tick. */
  readonly tsb: number | null;
  /** daily_load.form_zone as a ZoneKey; null = no active segment. */
  readonly zone: ZoneKey | null;
};

export function ZoneBar({ tsb, zone }: ZoneBarProps) {
  const end = tsb === null ? null : pinned(tsb);
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <div data-noswipe="" className="relative">
        <div className="flex h-2 gap-0.75">
          {BANDS.map((b, i) => (
            <span
              key={b.key}
              data-zone={b.key}
              data-active={b.key === zone ? "" : undefined}
              className={`block h-full ${b.key === zone ? ZONE_CLASS[b.key].fill : ZONE_CLASS[b.key].faint} ${
                i === 0 ? "rounded-l-cell" : ""
              } ${i === BANDS.length - 1 ? "rounded-r-cell" : ""}`}
              style={{ flexGrow: b.end - b.start, flexBasis: 0 }}
            />
          ))}
        </div>
        {tsb !== null && (
          <span
            data-today
            className="absolute -top-0.75 block h-3.5 w-0.5 -translate-x-1/2 bg-text"
            style={{ left: `clamp(1px, ${pct(position(tsb))}, calc(100% - 1px))` }}
          />
        )}
        {end !== null && (
          <svg
            viewBox="0 0 8 8"
            className={`absolute -top-3 size-2 text-text ${end === "low" ? "left-0" : "right-0"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d={end === "low" ? "M6 1 3 4l3 3" : "M2 1l3 3-3 3"} />
          </svg>
        )}
      </div>
      <div className="flex gap-0.75 font-mono text-11">
        {BANDS.map((b, i) => (
          <span
            key={b.key}
            className={`min-w-0 whitespace-nowrap ${i === 0 ? "text-left" : i === BANDS.length - 1 ? "text-right" : "text-center"} ${
              b.key === zone ? `${ZONE_CLASS[b.key].text} font-medium` : "text-text-muted"
            }`}
            style={{ flexGrow: b.end - b.start, flexBasis: 0 }}
          >
            {FORM_ZONE_DISPLAY[b.key]?.label ?? b.key}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Loading: the bar with no active segment and no tick. */
export function ZoneBarSkeleton() {
  return <ZoneBar tsb={null} zone={null} />;
}

type ZoneBarErrorProps = {
  /** Show this line's own retry; false when the plan failed too (its ErrorState retries both). */
  readonly retry: boolean;
};

/** The form read failed; the plan still renders. The retry is a soft navigation, so ticks survive. */
export function ZoneBarError({ retry }: ZoneBarErrorProps) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-14 text-warning">
      <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 shrink-0" fill="currentColor">
        <path d="M6 1 11 6 6 11 1 6Z" />
      </svg>
      <span>Kunne ikke hente form (TSB).</span>
      {retry && (
        <Link
          href="/train"
          prefetch={false}
          className="inline-flex min-h-11 items-center font-medium text-text underline underline-offset-3"
        >
          Prøv igen
        </Link>
      )}
    </p>
  );
}
