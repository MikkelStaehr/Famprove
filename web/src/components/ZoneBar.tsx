import Link from "next/link";
import type { ReactNode } from "react";

import type { IsoDate } from "@/lib/db/rows";
import { formatDay, formatDayLong, formatSigned, stopAfter } from "@/lib/format";
import { formSentence, type TrainingHeader, TSB_HINT } from "@/lib/training-view";
import { MARKS } from "@/lib/chart-marks";
import {
  BANDS,
  isZoneKey,
  pinned,
  position,
  SCALE_MAX,
  SCALE_MIN,
  THRESHOLDS,
  type ZoneKey,
  zoneSentence,
} from "@/lib/zone-scale";

/**
 * The zone ruler (DESIGN.md Part B Revision 5; design/specs/instrument-load.md §1–§2): the figure
 * row (caption, value, zone name in words) over a monochrome −40 … +30 ruler. The active zone comes
 * from daily_load.form_zone (header.zone.key) only, drawn as a thicker span of the baseline; the
 * thresholds only draw ticks. Today is the one red mark: a 2×28 tick at x(tsb).
 */

export type ZoneBarSize = "compact" | "hero";

// slot = the value row's height, so nothing shifts between loading, no-TSB and loaded.
const SIZE = {
  compact: { value: "text-24", name: "text-16", slot: "min-h-[calc(var(--text-24)*var(--text-24--line-height))]" },
  hero: { value: "text-56", name: "text-24", slot: "min-h-[calc(var(--text-56)*var(--text-56--line-height))]" },
} as const;

const pct = (x: number) => `${(x * 100).toFixed(4)}%`;

type ZoneBarProps = {
  /** null: no daily_load rows yet. */
  readonly header: TrainingHeader | null;
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
        <Ruler active={null} />
        <Thresholds />
      </div>
    );
  }
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
              <span className="text-14 text-text">
                fra <time dateTime={header.date}>{formatDay(header.date)}</time>
              </span>
            ) : undefined
          }
        />
        <p className={`mt-2 flex flex-wrap items-baseline gap-x-3 ${s.slot}`}>
          <span className={`font-sans font-normal whitespace-nowrap tabular-nums text-text ${s.value}`}>
            {formatSigned(header.tsb)}
          </span>
          {zoneKey !== null && header.zone !== null && (
            <span className={`font-sans font-normal whitespace-nowrap text-text ${s.name}`}>{header.zone.label}</span>
          )}
        </p>
        <Ruler active={zoneKey} tsb={header.tsb} />
        <Thresholds />
        {zoneKey === null && <p className="mt-1 text-14 text-text-muted">Zone ikke beregnet.</p>}
      </div>
    </div>
  );
}

/**
 * Træning's form row (instrument-traening.md, form flag row): text only, no pill, no swatch, no
 * scale. `caption` FORM (TSB), then value Inter 500 24 tabular + zone name Inter 400 16, the
 * zone's one-line hint and "Tallet er fra …" when the latest row is not today's. One sr-only
 * sentence carries all of it; the visual copy is hidden.
 */
export function ZoneFlagRow({ header, today }: { readonly header: TrainingHeader | null; readonly today: IsoDate }) {
  if (header === null) return <p className="text-16 text-text-muted">Form (TSB) er ikke beregnet endnu.</p>;
  const zoneKey = header.zone !== null && isZoneKey(header.zone.key) ? header.zone.key : null;
  const notToday = header.date !== today;
  return (
    <div>
      <p className="sr-only">{formSentence(header.tsb, zoneKey, notToday ? formatDayLong(header.date) : undefined)}</p>
      <div aria-hidden="true">
        <p className="caption">Form (TSB)</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="font-sans text-24 font-medium whitespace-nowrap tabular-nums text-text">
            {formatSigned(header.tsb)}
          </span>
          {zoneKey !== null && header.zone !== null && (
            <span className="font-sans text-16 font-normal whitespace-nowrap text-text">{header.zone.label}</span>
          )}
        </p>
        <p className={`mt-1 text-16 ${zoneKey === null ? "text-text-muted" : "text-text"}`}>
          {zoneKey === null ? "Zone ikke beregnet." : TSB_HINT[zoneKey]}
        </p>
        {notToday && (
          <p className="mt-1 text-14 text-text">
            Tallet er fra <time dateTime={header.date}>{formatDay(header.date)}</time>
            {stopAfter(formatDay(header.date))}
          </p>
        )}
      </div>
    </div>
  );
}

function LabelLine({ from }: { readonly from?: ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className="caption">Form (TSB) · TSS/dag</span>
      {from}
    </p>
  );
}

/** The ruler's drawing box (spec §2): viewBox 0 0 366 40, baseline at y 24. */
const W = 366;
const H = 40;
const BASE = 24;
const MINOR_STEP = 5;
const MINOR_TICKS: readonly number[] = Array.from(
  { length: Math.floor((SCALE_MAX - SCALE_MIN) / MINOR_STEP) + 1 },
  (_, i) => SCALE_MIN + i * MINOR_STEP,
).filter((v) => !THRESHOLDS.includes(v));
const TICK_TODAY = MARKS.todayTick;

/** x in the viewBox for a TSB value, with a 1-unit stroke kept inside the box. */
const rx = (v: number, w = 1) => Math.min(W - w, Math.max(0, position(v) * W - w / 2));

type RulerProps = {
  readonly active: ZoneKey | null;
  /** Today's TSB; none (loading, no TSB) = no red tick. */
  readonly tsb?: number;
};

/** Monochrome ruler: baseline, minor and threshold ticks, the active span 3px, today's red tick. */
function Ruler({ active, tsb }: RulerProps) {
  const band = active === null ? undefined : BANDS.find((b) => b.key === active);
  const end = tsb === undefined ? null : pinned(tsb);
  const tw = TICK_TODAY.width;
  const tx = tsb === undefined ? 0 : Math.min(W - tw, Math.max(0, position(tsb) * W - tw / 2));
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} className="mt-3 block h-auto w-full overflow-visible">
      <rect x={0} y={BASE - 0.5} width={W} height={1} fill="var(--text-muted)" />
      {MINOR_TICKS.map((v) => (
        <rect key={v} x={rx(v)} y={BASE - 6} width={1} height={6} fill="var(--text-muted)" />
      ))}
      {THRESHOLDS.map((v) => (
        <rect key={v} x={rx(v)} y={BASE - 14} width={1} height={14} fill="var(--text)" />
      ))}
      {band !== undefined && (
        <rect
          data-zone={band.key}
          x={band.start * W}
          y={BASE - 1.5}
          width={(band.end - band.start) * W}
          height={3}
          fill="var(--text)"
        />
      )}
      {tsb !== undefined && (
        <rect data-today x={tx} y={0} width={tw} height={TICK_TODAY.height.ruler} fill={TICK_TODAY.color} />
      )}
      {end !== null && (
        // 8px chevron pointing outward, just inside the pinned end, above the baseline.
        <path
          d={end === "low" ? "M10 2 6 6l4 4" : `M${W - 10} 2 ${W - 6} 6l-4 4`}
          fill="none"
          stroke="var(--text)"
          strokeWidth="1.5"
          strokeLinecap="square"
        />
      )}
    </svg>
  );
}

function Thresholds() {
  return (
    <p aria-hidden="true" className="relative -mt-2 h-lh font-mono text-12 text-text-muted tabular-nums">
      {THRESHOLDS.map((t) => (
        <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(position(t)) }}>
          {formatSigned(t).replace("+", "")}
        </span>
      ))}
    </p>
  );
}

/** Loading: real caption, a --surface bar for the value, the real ruler with no active span or red tick. */
export function ZoneBarSkeleton({ size }: { readonly size: ZoneBarSize }) {
  return (
    <div aria-hidden="true">
      <LabelLine />
      <div className={`mt-2 flex items-center ${SIZE[size].slot}`}>
        <span className={`block w-1/3 bg-surface motion-safe:animate-pulse ${size === "hero" ? "h-14" : "h-6"}`} />
      </div>
      <Ruler active={null} />
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
        <path d="M6 1 11 6 6 11 1 6Z" />
      </svg>
      <span>Kunne ikke hente form (TSB).</span>
      {retry && (
        <Link
          href="/"
          prefetch={false}
          className="inline-flex min-h-11 items-center font-medium text-text underline underline-offset-3"
        >
          Prøv igen
        </Link>
      )}
    </p>
  );
}
