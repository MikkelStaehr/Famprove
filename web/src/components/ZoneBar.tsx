import Link from "next/link";
import type { ReactNode } from "react";

import type { IsoDate } from "@/lib/db/rows";
import { formatDay, formatDayLong, formatSigned } from "@/lib/format";
import type { TodayHeader } from "@/lib/today-view";
import { BANDS, isZoneKey, pinned, position, THRESHOLDS, type ZoneKey, ZONE_FILL, zoneSentence } from "@/lib/zone-scale";

/**
 * DESIGN.md Part B › Zone bar: form (TSB) on the −40 … +30 scale. The active band comes from
 * daily_load.form_zone (header.zone.key) only; the thresholds only draw the bands.
 */

export type ZoneBarSize = "compact" | "hero";

// slot = flag height + 6px notch, so nothing shifts between loading, no-TSB and loaded.
const SIZE = {
  compact: { flag: "h-8 px-3", value: "text-24", slot: "min-h-[2.375rem]" },
  hero: { flag: "h-16 px-4", value: "text-56", slot: "min-h-[4.375rem]" },
} as const;

const pct = (x: number) => `${(x * 100).toFixed(4)}%`;

type ZoneBarProps = {
  /** null: no daily_load rows yet. */
  readonly header: TodayHeader | null;
  readonly today: IsoDate;
  readonly size: ZoneBarSize;
};

export function ZoneBar({ header, today, size }: ZoneBarProps) {
  const s = SIZE[size];
  if (header === null) {
    return (
      <div>
        <LabelLine />
        <p className={`mt-2 flex items-center text-16 text-text-muted ${s.slot}`}>
          Form er ikke beregnet endnu. Det daglige job beregner den omkring kl. 05.00.
        </p>
        <Bands active={null} />
        <Thresholds />
      </div>
    );
  }
  const x = position(header.tsb);
  const zoneKey = header.zone !== null && isZoneKey(header.zone.key) ? header.zone.key : null;
  const notToday = header.date !== today;
  return (
    <div>
      <p className="sr-only">
        {zoneSentence(header.tsb, zoneKey, notToday ? formatDayLong(header.date) : undefined)}
      </p>
      <div aria-hidden="true">
        <LabelLine
          from={
            notToday ? (
              <span className="text-14 font-semibold text-text">
                fra <time dateTime={header.date}>{formatDay(header.date)}</time>
              </span>
            ) : undefined
          }
        />
        <div className={`relative mt-2 ${s.slot}`}>
          <span
            className={`absolute top-0 inline-flex items-center whitespace-nowrap rounded-pill bg-slab text-on-slab ${s.flag}`}
            style={{ left: pct(x), transform: `translateX(-${pct(x)})` }}
          >
            <span className={`font-display font-extrabold italic tabular-nums ${s.value}`}>
              {formatSigned(header.tsb)}
            </span>
            {zoneKey !== null && header.zone !== null && (
              <>
                <span
                  className={`ml-2 size-3 shrink-0 rounded-mark ring-[1.5px] ring-on-slab ${ZONE_FILL[zoneKey]}`}
                />
                <span className="ml-1.5 text-14 font-bold uppercase tracking-[0.04em]">
                  {header.zone.label}
                </span>
              </>
            )}
          </span>
          <span
            className="absolute bottom-0 h-1.5 w-2 -translate-x-1/2 bg-slab [clip-path:polygon(0_0,100%_0,50%_100%)]"
            style={{ left: pct(x) }}
          />
        </div>
        <Bands active={zoneKey} marker={x} end={pinned(header.tsb)} />
        <Thresholds />
        {zoneKey === null && <p className="mt-1 text-14 text-text-muted">Zone ikke beregnet.</p>}
      </div>
    </div>
  );
}

function LabelLine({ from }: { readonly from?: ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className="flex items-baseline gap-2">
        <span className="text-14 font-bold uppercase tracking-[0.04em]">Form (TSB)</span>
        <span className="text-14 text-text-muted">TSS/dag</span>
      </span>
      {from}
    </p>
  );
}

type BandsProps = {
  readonly active: ZoneKey | null;
  /** Marker position 0..1; none without a TSB. */
  readonly marker?: number;
  readonly end?: "low" | "high" | null;
  readonly skeleton?: boolean;
};

/** Five bands at their exact spans, 2px inset at inner edges (a 4px gap centred on each threshold). */
function Bands({ active, marker, end = null, skeleton = false }: BandsProps) {
  return (
    <div aria-hidden="true" className="relative h-3">
      {BANDS.map((band) => (
        <span
          key={band.key}
          className={`absolute inset-y-0 rounded-mark ${
            skeleton ? "bg-track motion-safe:animate-pulse" : ZONE_FILL[band.key]
          } ${band.key === active ? "outline-2 -outline-offset-2 outline-text" : ""}`}
          style={{
            left: band.start === 0 ? 0 : `calc(${pct(band.start)} + 2px)`,
            right: band.end === 1 ? 0 : `calc(${pct(1 - band.end)} + 2px)`,
          }}
        />
      ))}
      {marker !== undefined && (
        <span className="absolute top-0 h-4 w-[3px] -translate-x-1/2 bg-slab" style={{ left: pct(marker) }} />
      )}
      {end !== null && (
        <svg
          viewBox="0 0 8 12"
          className={`absolute top-0 h-3 w-2 text-slab ${end === "low" ? "-left-2.5" : "-right-2.5"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={end === "low" ? "M6.5 1.5 2 6l4.5 4.5" : "M1.5 1.5 6 6l-4.5 4.5"} />
        </svg>
      )}
    </div>
  );
}

function Thresholds() {
  return (
    <p aria-hidden="true" className="relative mt-1 h-lh text-14 font-semibold text-text-muted tabular-nums">
      {THRESHOLDS.map((t) => (
        <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(position(t)) }}>
          {formatSigned(t).replace("+", "")}
        </span>
      ))}
    </p>
  );
}

/** Loading: the label line and thresholds are real text, the bands --track, no flag or marker. */
export function ZoneBarSkeleton({ size }: { readonly size: ZoneBarSize }) {
  return (
    <div aria-hidden="true">
      <LabelLine />
      <div className={`mt-2 ${SIZE[size].slot}`} />
      <Bands active={null} skeleton />
      <Thresholds />
    </div>
  );
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
        <path d="M6 1 11 11H1Z" />
      </svg>
      <span>Kunne ikke hente form (TSB).</span>
      {retry && (
        <Link
          href="/"
          prefetch={false}
          className="inline-flex min-h-11 items-center font-semibold text-text underline underline-offset-3"
        >
          Prøv igen
        </Link>
      )}
    </p>
  );
}
