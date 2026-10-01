"use client";

import { catchError, type ErrorInfo } from "next/error";
import { type ReactNode, useSyncExternalStore } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  type BlockSpan,
  CHART_WINDOW_DAYS,
  type ChartPoint,
  ctlBandArea,
  type DashboardView,
  strengthUnknownFrom,
} from "@/lib/dashboard-view";
import { dayNumber } from "@/lib/dates";
import { formatDate, formatDay, LOCALE, TSS_PER_DAY } from "@/lib/format";
import { prognoseStatus, rangeText, strengthLine, strengthUnknownNote } from "@/lib/prognose-text";

import { LineSample, SERIES } from "./ChartSeries";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { WarningLine } from "./WarningLine";

/**
 * CTL / ATL / TSB per day, centred on the latest measured day ("i dag"), with the prognose to
 * its right (load.md §9) with the CTL band after the block (§10), strength blocks shaded and
 * deload weeks hatched.
 * Plots Python's values as-is; the only arithmetic here is date -> x position.
 * The text alternative is rendered by the (server) page next to this component.
 */
type Projection = Extract<DashboardView, { kind: "ready" }>["projection"];

type TrendChartProps = {
  readonly points: readonly ChartPoint[];
  readonly blocks: readonly BlockSpan[];
  /** The latest daily_load date: the "i dag" rule; measured left of it, prognose right of it. */
  readonly lastActual: string; // the latest computed day: the prognose region starts after it
  readonly today: string; // the local date (or DEV_TODAY): the "i dag" rule and window centre
  readonly projection: Projection;
  /** Accessible name of the SVG; the page renders the text alternative (figcaption). */
  readonly title: string;
  /** Rendered under the legend, above the plot, whenever the legend is (load.md §8b). */
  readonly explainer?: ReactNode;
};

const HATCH_ID = "deload-hatch";
const LEGEND_HATCH_ID = "deload-hatch-legend";
const DAY_MS = 86_400_000;
const WINDOW_DAYS = CHART_WINDOW_DAYS;
export const TICK = { fill: "var(--text-muted)", fontSize: 12, fontWeight: 500 } as const;
const WEEKDAY_FORMAT = new Intl.DateTimeFormat(LOCALE, { weekday: "long", timeZone: "UTC" });

/** Plot geometry shared by the SVG and the HTML strip/region/rule so they line up exactly. */
const Y_AXIS_WIDTH = 32;
const MARGIN_RIGHT = 16;
const X_AXIS_HEIGHT = 30;
const BLOCK_LABEL_ROOM = 18;

// ctlBand: [ctl_low, ctl_high] as stored, or null; a plain field so Recharts reads it as a range.
type Row = ChartPoint & { readonly x: number; readonly ctlBand: readonly [number, number] | null };

/** "5. aug." (da-DK), no weekday. */
function formatTick(day: number): string {
  return formatDate(new Date(day * DAY_MS).toISOString().slice(0, 10));
}

/** Axis tick with a real minus sign. */
function formatAxisValue(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : String(value);
}

/** CSS length of a day's x position inside the chart box (matches Recharts' x scale). */
function xCss(fraction: number): string {
  return `(${Y_AXIS_WIDTH}px + (100% - ${Y_AXIS_WIDTH + MARGIN_RIGHT}px) * ${fraction})`;
}

const subscribeNothing = () => () => {};

/** false on the server and during hydration, true afterwards (the chart measures the DOM). */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

const WIDE_QUERY = "(min-width: 640px)";

function subscribeWide(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** true from 640px: 9 ticks every 14 days instead of 5 every 28 (load.md §9a). */
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

function ChartFailed({ what }: { readonly what: string }, { reset }: ErrorInfo) {
  return <ErrorState title="Grafen kan ikke vises" what={what} retry={{ onRetry: reset }} />;
}

export const ChartBoundary = catchError(ChartFailed);

export function TrendChart(props: TrendChartProps) {
  const measured = props.points.filter((p) => p.kind === "actual").length;
  if (measured < 2) {
    return <EmptyState message="Trenden vises, når der er mindst to dages træningsbelastning." />;
  }
  const hasPrognose = props.points.some((p) => p.kind === "projected");
  const unknownFrom = hasPrognose ? strengthUnknownFrom(props.points) : null;
  return (
    <div className="flex flex-col gap-2">
      <Legend />
      {props.explainer !== undefined && <div className="mb-1">{props.explainer}</div>}
      <p className="text-12 font-medium text-text-muted" aria-hidden="true">
        {TSS_PER_DAY}
      </p>
      <ChartBoundary what="Grafen kunne ikke tegnes. Tallene ovenfor er ikke berørt.">
        <Chart
          points={props.points}
          blocks={props.blocks}
          lastActual={props.lastActual}
          today={props.today}
          title={props.title}
        />
      </ChartBoundary>
      {!hasPrognose && props.projection === "error" && (
        <WarningLine>
          Prognosen kunne ikke hentes, så grafen viser kun målte dage. Genindlæs siden for at prøve igen.
        </WarningLine>
      )}
      {!hasPrognose && props.projection !== "error" && (
        <p className="text-14 text-text-muted">
          Ingen prognose endnu. Den beregnes af det daglige job omkring kl. 05.00.
        </p>
      )}
      {unknownFrom !== null && <p className="max-w-[60ch] text-14 text-text-muted">{strengthUnknownNote(unknownFrom)}</p>}
    </div>
  );
}

type ChartProps = Pick<TrendChartProps, "points" | "blocks" | "lastActual" | "today" | "title">;

function Chart({ points, blocks, lastActual, today: todayDate, title }: ChartProps) {
  const hydrated = useHydrated();
  const wide = useWide();
  if (!hydrated) {
    return <div className="h-(--chart-height) w-full rounded-control bg-track motion-safe:animate-pulse" />;
  }

  const rows: Row[] = points.map((p) => ({ ...p, x: dayNumber(p.date), ctlBand: ctlBandArea(p) }));
  const byDay = new Map(rows.map((r) => [r.x, r]));
  // Spec §9b/§9e: the rule sits on today; after a missed run the region starts left of it.
  const today = dayNumber(todayDate);
  const dataEnd = dayNumber(lastActual);
  const prognose = rows.some((r) => r.kind === "projected");
  const last = prognose ? today + WINDOW_DAYS : today;
  const lo = today - WINDOW_DAYS - 0.5;
  const hi = last + 0.5;
  const todayX = xCss((today - lo) / (hi - lo));
  const regionX = xCss((Math.min(dataEnd, today) - lo) / (hi - lo));
  const step = wide ? 14 : 28;
  const ticks: number[] = [];
  for (let d = -WINDOW_DAYS; d <= WINDOW_DAYS && today + d <= last; d += step) ticks.push(today + d);
  const firstTick = ticks[0];
  const lastTick = ticks[ticks.length - 1];
  const todayRow = byDay.get(today);

  return (
    <div className="relative flex h-(--chart-height) w-full flex-col">
      {prognose && (
        <div
          aria-hidden="true"
          className="absolute top-0 bg-track/60"
          style={{ left: `calc${regionX}`, right: MARGIN_RIGHT, bottom: X_AXIS_HEIGHT }}
        />
      )}
      <div
        aria-hidden="true"
        className="absolute top-0 w-px bg-text"
        style={{ left: `calc(${todayX} - 0.5px)`, bottom: X_AXIS_HEIGHT }}
      />
      <div aria-hidden="true" className="relative min-h-6 shrink-0">
        <span
          className="absolute top-0 rounded-mark bg-surface px-1 py-0.5 text-14 font-semibold whitespace-nowrap text-text"
          style={{ right: `calc(100% - ${todayX} + 4px)` }}
        >
          i dag
        </span>
        {prognose && (
          <p
            className="py-0.5 text-14 font-semibold text-text-muted"
            style={{ marginLeft: `calc(${todayX} + 6px)`, marginRight: MARGIN_RIGHT }}
          >
            {/* no-break space: at 200% text it wraps as "Prognose ·" / "anslået" (load.md §9b) */}
            Prognose{" "}· anslået
          </p>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <ComposedChart
          responsive
          style={{ width: "100%", height: "100%" }}
          data={rows}
          margin={{ top: BLOCK_LABEL_ROOM, right: MARGIN_RIGHT, bottom: 0, left: 0 }}
          title={title}
        >
          <defs>
            <HatchPattern id={HATCH_ID} />
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          {blocks.map((b) => {
            const x1 = Math.max(dayNumber(b.start) - 0.5, lo);
            const x2 = Math.min(dayNumber(b.end) + 0.5, today);
            return x2 <= x1 ? null : (
              <ReferenceArea
                key={`block-${b.start}-${b.name}`}
                ifOverflow="hidden"
                x1={x1}
                x2={x2}
                fill="var(--block-fill)"
                fillOpacity={1}
                label={{ value: `B${b.blockNo}`, position: "top", ...TICK }}
              />
            );
          })}
          {blocks.map((b) => {
            if (b.deloadStart === null) return null;
            const x1 = Math.max(dayNumber(b.deloadStart) - 0.5, lo);
            const x2 = Math.min(dayNumber(b.end) + 0.5, today);
            return x2 <= x1 ? null : (
              <ReferenceArea
                key={`deload-${b.start}-${b.name}`}
                ifOverflow="hidden"
                x1={x1}
                x2={x2}
                fill={`url(#${HATCH_ID})`}
                fillOpacity={1}
              />
            );
          })}
          <ReferenceLine y={0} stroke="var(--chart-mark)" />
          <XAxis
            dataKey="x"
            type="number"
            domain={[lo, hi]}
            ticks={ticks}
            interval={0}
            height={X_AXIS_HEIGHT}
            tick={(p: TickProps) => <DateTick {...p} first={firstTick} last={lastTick} today={today} />}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            width={Y_AXIS_WIDTH}
            domain={["auto", "auto"]}
            allowDecimals={false}
            tickFormatter={formatAxisValue}
            tick={TICK}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            isAnimationActive={false}
            cursor={{ stroke: "var(--text-muted)", strokeWidth: 1 }}
            content={({ active, label }) => (
              <ChartTooltip active={active} x={label} byDay={byDay} blocks={blocks} />
            )}
          />
          {/* load.md §10a: CTL only, [ctl_low, ctl_high] as stored; above the region, below the lines. */}
          <Area
            dataKey="ctlBand"
            type="linear"
            stroke="none"
            fill="var(--prognose-band)"
            fillOpacity={1}
            dot={false}
            activeDot={false}
            legendType="none"
            tooltipType="none"
            isAnimationActive={false}
          />
          {SERIES.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.label}
              type="linear"
              stroke={s.color}
              strokeWidth={s.width}
              strokeDasharray={s.dash}
              strokeLinecap="round"
              dot={false}
              activeDot={{ r: 4, fill: s.color, stroke: "var(--surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
          {todayRow !== undefined &&
            SERIES.map((s) => (
              <ReferenceDot
                key={`today-${s.key}`}
                x={today}
                y={todayRow[s.key]}
                r={3.5}
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth={2}
                ifOverflow="visible"
              />
            ))}
        </ComposedChart>
      </div>
    </div>
  );
}

type TickProps = {
  readonly x?: number | string;
  readonly y?: number | string;
  readonly payload?: { readonly value?: unknown };
};

type DateTickProps = TickProps & {
  readonly first: number | undefined;
  readonly last: number | undefined;
  readonly today: number;
};

/** Date tick: first start-anchored, last end-anchored (never clipped); today's in 600 --text. */
function DateTick({ x, y, payload, first, last, today }: DateTickProps) {
  const value = payload?.value;
  if (typeof value !== "number") return <g />;
  const anchor = value === last && first !== last ? "end" : value === first ? "start" : "middle";
  const isToday = value === today;
  return (
    <text
      x={Number(x)}
      y={Number(y)}
      dy={12}
      textAnchor={anchor}
      fontSize={12}
      fontWeight={isToday ? 600 : 500}
      fill={isToday ? "var(--text)" : "var(--text-muted)"}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {formatTick(value)}
    </text>
  );
}

type ChartTooltipProps = {
  readonly active: boolean;
  readonly x: string | number | undefined;
  readonly byDay: ReadonlyMap<number, Row>;
  readonly blocks: readonly BlockSpan[];
};

function ChartTooltip({ active, x, byDay, blocks }: ChartTooltipProps) {
  const row = active && typeof x === "number" ? byDay.get(x) : undefined;
  if (row === undefined) return null;
  if (row.kind === "projected") return <PrognoseTooltip row={row} />;
  const block = blocks.find((b) => b.start <= row.date && row.date <= b.end);
  const deload = block !== undefined && block.deloadStart !== null && block.deloadStart <= row.date;
  return (
    <div className="flex flex-col gap-1 rounded-control border border-border bg-surface px-3 py-2 text-14 text-text shadow-card">
      <p className="font-semibold">{formatDay(row.date)}</p>
      <SeriesValues row={row} approx={false} />
      {block !== undefined && (
        <p className="text-14 text-text-muted">
          {block.name}
          {deload && " · deload"}
        </p>
      )}
    </div>
  );
}

/** Values; on prognose days with "≈" and, where Python stored a non-flat band, its range (§10c). */
function SeriesValues({ row, approx }: { readonly row: Row; readonly approx: boolean }) {
  return (
    <dl className="grid grid-cols-[auto_auto] items-center gap-x-3 tabular-nums">
      {SERIES.map((s) => (
        <div key={s.key} className="contents">
          <dt className="flex items-center gap-2">
            <LineSample series={s} />
            {s.label}
          </dt>
          <dd className="text-right font-semibold">
            {/* each part stays whole; the range wraps under the value when space runs out (§10c) */}
            <span className="whitespace-nowrap">{approx ? `≈ ${s.format(row[s.key])}` : s.format(row[s.key])}</span>
            {approx && <Range text={rangeText(row.bands?.[s.key] ?? null, s.format)} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Range({ text }: { readonly text: string }) {
  if (text === "") return null;
  return (
    <>
      {" "}
      <span className="whitespace-nowrap">{text.trim()}</span>
    </>
  );
}

/** load.md §9c/§10c: a future day is an estimate; say so, and say what it was built from. */
function PrognoseTooltip({ row }: { readonly row: Row }) {
  const estimate = row.estimate;
  const cycling = estimate === null ? null : cyclingLine(row.date, estimate);
  return (
    <div className="flex max-w-72 flex-col gap-1 rounded-control border border-border bg-surface px-3 py-2 text-14 text-text shadow-card">
      <p className="font-semibold">{formatDay(row.date)}</p>
      <p className="text-14 font-semibold text-text-muted">{prognoseStatus(estimate)}</p>
      <SeriesValues row={row} approx />
      {estimate !== null && (cycling !== null || estimate.sessions.length > 0) && (
        <ul className="flex flex-col text-14 text-text-muted tabular-nums">
          {cycling !== null && <li>{cycling}</li>}
          {estimate.sessions.map((s, i) => (
            <li key={i}>{/* index: two sessions can share a number on one day */}
              {strengthLine(s)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function cyclingLine(date: string, estimate: NonNullable<ChartPoint["estimate"]>): string | null {
  if (estimate.cyclingSource === "planned") {
    return `Cykel ${Math.round(estimate.cyclingTss)} TSS · planlagt tur`;
  }
  // A planned ride that couldn't be read falls back to the typical day: say so (never hidden).
  const unread = estimate.rides.some((r) => r.tss === null) ? " (planlagt tur kunne ikke læses)" : "";
  if (estimate.cyclingTss <= 0 && unread === "") return null;
  const weekday = WEEKDAY_FORMAT.format(new Date(`${date}T00:00:00Z`));
  return `Cykel ≈ ${Math.round(estimate.cyclingTss)} TSS · typisk ${weekday}${unread}`;
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-14 text-text" aria-label="Forklaring">
      {SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-2">
          <LineSample series={s} />
          {s.label}
        </li>
      ))}
      <li className="flex items-center gap-2">
        <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 shrink-0">
          <rect x="0.5" y="0.5" width="11" height="11" fill="var(--block-fill)" stroke="var(--chart-mark)" />
        </svg>
        Styrkeblok
      </li>
      <li className="flex items-center gap-2">
        <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 shrink-0">
          <defs>
            <HatchPattern id={LEGEND_HATCH_ID} />
          </defs>
          <rect x="0.5" y="0.5" width="11" height="11" fill={`url(#${LEGEND_HATCH_ID})`} stroke="var(--chart-mark)" />
        </svg>
        Deload-uge
      </li>
    </ul>
  );
}

/** Diagonal hatch: deload weeks differ from block shading by pattern, not only colour. */
function HatchPattern({ id }: { readonly id: string }) {
  return (
    <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="6" height="6" fill="var(--block-fill)" />
      <line x1="1" y1="0" x2="1" y2="6" stroke="var(--chart-mark)" strokeWidth="2" />
    </pattern>
  );
}
