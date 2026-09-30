"use client";

import { catchError, type ErrorInfo } from "next/error";
import { type ReactNode, useSyncExternalStore } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BlockSpan, ChartPoint } from "@/lib/dashboard-view";
import { formatDay, LOCALE, TSS_PER_DAY } from "@/lib/format";

import { LineSample, SERIES } from "./ChartSeries";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";

/**
 * CTL / ATL / TSB per day with strength blocks shaded and deload weeks hatched.
 * Plots Python's values as-is; the only arithmetic here is date -> x position.
 * The text alternative is rendered by the (server) page next to this component.
 */
type TrendChartProps = {
  readonly points: readonly ChartPoint[];
  readonly blocks: readonly BlockSpan[];
  /** Accessible name of the SVG; the page renders the text alternative (figcaption). */
  readonly title: string;
  /** Rendered under the legend, above the plot, whenever the legend is (load.md §8b). */
  readonly explainer?: ReactNode;
};

const HATCH_ID = "deload-hatch";
const LEGEND_HATCH_ID = "deload-hatch-legend";
const DAY_MS = 86_400_000;
const TICK = { fill: "var(--text-muted)", fontSize: 12, fontWeight: 500 } as const;
const MONTH_FORMAT = new Intl.DateTimeFormat(LOCALE, { month: "short", timeZone: "UTC" });

type Row = ChartPoint & { readonly x: number };

/** Calendar date -> whole days since the epoch (UTC, so no time-zone shift). */
function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

/** First day of every month inside [first, last]. */
function monthTicks(first: number, last: number): number[] {
  const start = new Date(first * DAY_MS);
  const ticks: number[] = [];
  let month = start.getUTCMonth() + (start.getUTCDate() === 1 ? 0 : 1);
  for (;;) {
    const tick = Date.UTC(start.getUTCFullYear(), month, 1) / DAY_MS;
    if (tick > last) return ticks;
    ticks.push(tick);
    month += 1;
  }
}

/** "jan.", "feb.", … "okt." (da-DK). */
function formatMonthTick(day: number): string {
  return MONTH_FORMAT.format(new Date(day * DAY_MS));
}

/** Axis tick with a real minus sign. */
function formatAxisValue(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : String(value);
}

const subscribeNothing = () => () => {};

/** false on the server and during hydration, true afterwards (the chart measures the DOM). */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

function ChartFailed({ what }: { readonly what: string }, { reset }: ErrorInfo) {
  return <ErrorState title="Grafen kan ikke vises" what={what} retry={{ onRetry: reset }} />;
}

const ChartBoundary = catchError(ChartFailed);

export function TrendChart(props: TrendChartProps) {
  if (props.points.length < 2) {
    return <EmptyState message="Trenden vises, når der er mindst to dages træningsbelastning." />;
  }
  return (
    <div className="flex flex-col gap-2">
      <Legend />
      {props.explainer !== undefined && <div className="mb-1">{props.explainer}</div>}
      <p className="text-12 font-medium text-text-muted" aria-hidden="true">
        {TSS_PER_DAY}
      </p>
      <ChartBoundary what="Grafen kunne ikke tegnes. Tallene ovenfor er ikke berørt.">
        <Chart points={props.points} blocks={props.blocks} title={props.title} />
      </ChartBoundary>
    </div>
  );
}

function Chart({ points, blocks, title }: Omit<TrendChartProps, "explainer">) {
  const hydrated = useHydrated();
  if (!hydrated) {
    return <div className="h-(--chart-height) w-full rounded-control bg-track motion-safe:animate-pulse" />;
  }

  const rows: Row[] = points.map((p) => ({ ...p, x: dayNumber(p.date) }));
  const byDay = new Map(rows.map((r) => [r.x, r]));
  const first = rows[0].x;
  const last = rows[rows.length - 1].x;

  return (
    <div className="h-(--chart-height) w-full">
      <LineChart
        responsive
        style={{ width: "100%", height: "100%" }}
        data={rows}
        margin={{ top: 20, right: 16, bottom: 0, left: 0 }}
        title={title}
      >
        <defs>
          <HatchPattern id={HATCH_ID} />
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        {blocks.map((b) => (
          <ReferenceArea
            key={`block-${b.start}-${b.name}`}
            ifOverflow="hidden"
            x1={dayNumber(b.start) - 0.5}
            x2={dayNumber(b.end) + 0.5}
            fill="var(--block-fill)"
            fillOpacity={1}
            label={{ value: `B${b.blockNo}`, position: "top", ...TICK }}
          />
        ))}
        {blocks.map((b) =>
          b.deloadStart === null ? null : (
            <ReferenceArea
              key={`deload-${b.start}-${b.name}`}
              ifOverflow="hidden"
              x1={dayNumber(b.deloadStart) - 0.5}
              x2={dayNumber(b.end) + 0.5}
              fill={`url(#${HATCH_ID})`}
              fillOpacity={1}
            />
          ),
        )}
        <ReferenceLine y={0} stroke="var(--chart-mark)" />
        <XAxis
          dataKey="x"
          type="number"
          domain={[first - 0.5, last + 0.5]}
          ticks={monthTicks(first, last)}
          tickFormatter={formatMonthTick}
          tick={TICK}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          minTickGap={8}
        />
        <YAxis
          width={32}
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
      </LineChart>
    </div>
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
  const block = blocks.find((b) => b.start <= row.date && row.date <= b.end);
  const deload = block !== undefined && block.deloadStart !== null && block.deloadStart <= row.date;
  return (
    <div className="flex flex-col gap-1 rounded-control border border-border bg-surface px-3 py-2 text-14 text-text shadow-card">
      <p className="font-semibold">{formatDay(row.date)}</p>
      <dl className="grid grid-cols-[auto_auto] items-center gap-x-3 tabular-nums">
        {SERIES.map((s) => (
          <div key={s.key} className="contents">
            <dt className="flex items-center gap-2">
              <LineSample series={s} />
              {s.label}
            </dt>
            <dd className="text-right font-semibold">{s.format(row[s.key])}</dd>
          </div>
        ))}
      </dl>
      {block !== undefined && (
        <p className="text-14 text-text-muted">
          {block.name}
          {deload && " · deload"}
        </p>
      )}
    </div>
  );
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
