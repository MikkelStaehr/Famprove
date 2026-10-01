"use client";

import { useState } from "react";
import { ComposedChart, CartesianGrid, Line, Tooltip, XAxis, YAxis } from "recharts";

import { type AxisTick, formatEf, type LineChartView, type Mark, type Seam, type WeekBar } from "@/lib/analyse-view";
import { formatLoad } from "@/lib/format";

import { ChartBoundary, TICK, useHydrated, useWide } from "./TrendChart";

/**
 * /analyse charts (design/specs/analyse.md §4-§5). One x domain [lo, hi] for all three, the pause
 * seams drawn the same way in each, no motion. Plots the view model's values as-is.
 */

const Y_AXIS_WIDTH = 36;
const MARGIN_RIGHT = 16;
const X_AXIS_HEIGHT = 30;
const SEAM_ROOM = 18;
const CHART_FAILED = "Grafen kunne ikke tegnes. De andre tal på siden er ikke berørt.";

type Axis = {
  readonly lo: number;
  readonly hi: number;
  readonly ticksNarrow: readonly AxisTick[];
  readonly ticksWide: readonly AxisTick[];
  readonly seams: readonly Seam[];
};

/** CSS x of a day inside the chart box (matches Recharts' x scale). */
function xCss(axis: Axis, x: number): string {
  const f = (x - axis.lo) / (axis.hi - axis.lo);
  return `calc(${Y_AXIS_WIDTH}px + (100% - ${Y_AXIS_WIDTH + MARGIN_RIGHT}px) * ${f})`;
}

function Skeleton({ height }: { readonly height: string }) {
  return <div className={`${height} w-full rounded-control bg-track motion-safe:animate-pulse`} />;
}

/** Spec §4: dashed edges and a centred "Ingen ture" label in the 18px top strip; aria-hidden. */
function SeamOverlay({ axis, bottom }: { readonly axis: Axis; readonly bottom: number }) {
  return (
    <>
      {axis.seams.map((s) => (
        <div key={s.x0} aria-hidden="true">
          {[s.x0, s.x1].map((x) => (
            <div
              key={x}
              className="absolute top-0 w-px"
              style={{
                left: xCss(axis, x),
                bottom,
                backgroundImage: "repeating-linear-gradient(to bottom, var(--chart-mark) 0 3px, transparent 3px 6px)",
              }}
            />
          ))}
          <div
            className="@container absolute top-0 flex h-[18px] items-center justify-center overflow-hidden"
            style={{ left: xCss(axis, s.x0), width: `calc(${xCss(axis, s.x1)} - ${xCss(axis, s.x0)})` }}
          >
            {/* Omitted (not clipped) when the run is narrower than the label. */}
            <span className="hidden text-12 font-medium whitespace-nowrap text-text-muted @[4.5rem]:inline">Ingen ture</span>
          </div>
        </div>
      ))}
    </>
  );
}

type TickProps = { readonly x?: number | string; readonly y?: number | string; readonly payload?: { readonly value?: unknown } };

function DateTick({ x, y, payload, ticks, hi }: TickProps & { readonly ticks: readonly AxisTick[]; readonly hi: number }) {
  const value = payload?.value;
  const tick = ticks.find((t) => t.x === value);
  if (tick === undefined) return <g />;
  const anchor = tick === ticks[0] ? "start" : hi - tick.x < 30 ? "end" : "middle";
  return (
    <text x={Number(x)} y={Number(y)} dy={12} textAnchor={anchor} {...TICK} style={{ fontVariantNumeric: "tabular-nums" }}>
      {tick.label}
    </text>
  );
}

function TipBox({ lines }: { readonly lines: readonly string[] }) {
  return (
    <div className="flex max-w-72 flex-col gap-1 rounded-control border border-border bg-surface px-3 py-2 text-14 text-text shadow-card tabular-nums">
      {lines.map((l, i) => (
        <p key={i} className={i === 0 ? "font-semibold" : undefined}>
          {l}
        </p>
      ))}
    </div>
  );
}

type Row = { x: number; excl: number | null; dots: number | null; marks: Mark[] } & Record<string, unknown>;

type DotProps = { readonly cx?: number; readonly cy?: number; readonly payload?: Row; readonly value?: unknown };

type LineChartProps = {
  readonly axis: Axis;
  readonly chart: LineChartView;
  readonly title: string;
  readonly variant: "eftp" | "ef";
};

export function MarkChart(props: LineChartProps) {
  return (
    <ChartBoundary what={CHART_FAILED}>
      <MarkChartInner {...props} />
    </ChartBoundary>
  );
}

function MarkChartInner({ axis, chart, title, variant }: LineChartProps) {
  const format = variant === "eftp" ? formatLoad : formatEf;
  const hydrated = useHydrated();
  const wide = useWide();
  if (!hydrated) return <Skeleton height="h-(--chart-height)" />;
  const ticks = wide ? axis.ticksWide : axis.ticksNarrow;
  const bottom = chart.domain[0];
  // One row per x; segment keys s0..sN carry the line (a new key after every break, spec §5b/§5c).
  const byX = new Map<number, Row>();
  for (const m of chart.marks) {
    const row = byX.get(m.x) ?? { x: m.x, excl: null, dots: null, marks: [] };
    row.marks.push(m);
    if (m.excluded) row.excl = bottom;
    else if (variant === "eftp") row[`s${m.seg}`] = m.y;
    else {
      row.dots = m.y;
      if (m.trend !== null) row[`s${m.seg}`] = m.trend;
    }
    byX.set(m.x, row);
  }
  const rows = [...byX.values()].sort((a, b) => a.x - b.x);
  const segKeys = Array.from({ length: chart.segments }, (_, i) => `s${i}`);

  const pointDot = ({ cx, cy, payload, value }: DotProps) => {
    if (typeof value !== "number" || cx === undefined || cy === undefined) return <g key={`${cx}-${cy}`} />;
    const latest = payload?.marks.some((m) => m.latest) ?? false;
    return latest ? (
      <circle key={`${cx}-l`} cx={cx} cy={cy} r={4.5} fill="var(--slab)" stroke="var(--surface)" strokeWidth={2} />
    ) : (
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2.5} fill="var(--text)" />
    );
  };
  const hollow = ({ cx, cy, value }: DotProps) =>
    typeof value !== "number" || cx === undefined || cy === undefined ? (
      <g key={`${cx}-e`} />
    ) : (
      <circle key={`${cx}-e`} cx={cx} cy={cy} r={3.5} fill="var(--surface)" stroke="var(--text-muted)" strokeWidth={1.5} />
    );
  const efDot = ({ cx, cy, value }: DotProps) =>
    typeof value !== "number" || cx === undefined || cy === undefined ? (
      <g key={`${cx}-d`} />
    ) : (
      <circle key={`${cx}-${cy}-d`} cx={cx} cy={cy} r={3} fill="var(--chart-mark)" />
    );

  return (
    <div className="relative h-(--chart-height) w-full">
      <ComposedChart
        responsive
        style={{ width: "100%", height: "100%" }}
        data={rows}
        margin={{ top: SEAM_ROOM, right: MARGIN_RIGHT, bottom: 0, left: 0 }}
        title={title}
      >
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="x"
          type="number"
          domain={[axis.lo, axis.hi]}
          ticks={ticks.map((t) => t.x)}
          interval={0}
          height={X_AXIS_HEIGHT}
          tick={(p: TickProps) => <DateTick {...p} ticks={ticks} hi={axis.hi} />}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
        />
        <YAxis
          width={Y_AXIS_WIDTH}
          domain={[chart.domain[0], chart.domain[1]]}
          ticks={[...chart.ticks]}
          tickFormatter={format}
          tick={TICK}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: "var(--text-muted)", strokeWidth: 1 }}
          content={({ active, label }) => {
            const row = active && typeof label === "number" ? byX.get(label) : undefined;
            return row === undefined ? null : <TipBox lines={row.marks.flatMap((m) => m.tip)} />;
          }}
        />
        {variant === "ef" && (
          <Line dataKey="dots" stroke="none" dot={efDot} activeDot={false} isAnimationActive={false} legendType="none" />
        )}
        {segKeys.map((k) => (
          <Line
            key={k}
            dataKey={k}
            type="linear"
            connectNulls
            stroke="var(--text)"
            strokeWidth={2.5}
            strokeLinecap="round"
            dot={variant === "eftp" ? pointDot : false}
            activeDot={false}
            isAnimationActive={false}
          />
        ))}
        <Line dataKey="excl" stroke="none" dot={hollow} activeDot={false} isAnimationActive={false} legendType="none" />
      </ComposedChart>
      <SeamOverlay axis={axis} bottom={X_AXIS_HEIGHT} />
    </div>
  );
}

// --- weekly strips (spec §5d) --------------------------------------------------------------

const STRIP = 112;

type WeeksProps = {
  readonly axis: Axis;
  readonly weeks: readonly WeekBar[];
  readonly max: { readonly hours: number; readonly load: number };
};

export function WeekStrips(props: WeeksProps) {
  return (
    <ChartBoundary what={CHART_FAILED}>
      <WeekStripsInner {...props} />
    </ChartBoundary>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((s) => s * p >= v) ?? 10) * p;
}

function WeekStripsInner({ axis, weeks, max }: WeeksProps) {
  const hydrated = useHydrated();
  const wide = useWide();
  const [active, setActive] = useState<WeekBar | null>(null);
  if (!hydrated) return <Skeleton height="h-[232px]" />;
  const ticks = wide ? axis.ticksWide : axis.ticksNarrow;
  const hMax = niceMax(max.hours);
  const lMax = niceMax(max.load);

  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - box.left - Y_AXIS_WIDTH) / (box.width - Y_AXIS_WIDTH - MARGIN_RIGHT);
    const x = axis.lo + f * (axis.hi - axis.lo);
    setActive(weeks.find((w) => w.x0 <= x && x < w.x1) ?? null);
  };

  const strip = (label: string, unit: string, top: number, value: (w: WeekBar) => number, vMax: number) => (
    <div className="relative" style={{ height: STRIP }}>
      <div className="absolute border-b border-border" style={{ left: Y_AXIS_WIDTH, right: MARGIN_RIGHT, bottom: 0 }} />
      <div className="absolute border-t border-border" style={{ left: Y_AXIS_WIDTH, right: MARGIN_RIGHT, top: top }} />
      <span className="absolute left-0 text-12 font-medium text-text-muted tabular-nums" style={{ top: top - 8 }}>
        {vMax.toLocaleString("da-DK")}
      </span>
      <span className="absolute bottom-0 left-0 text-12 font-medium text-text-muted">0</span>
      <p className="absolute top-0 text-14 font-semibold" style={{ left: Y_AXIS_WIDTH }}>
        {label} <span className="font-normal text-text-muted">{unit}</span>
      </p>
      {weeks.map((w) => {
        const left = xCss(axis, w.x0);
        const width = `calc(${xCss(axis, w.x1)} - ${xCss(axis, w.x0)} - 1px)`;
        const color = w.current ? "bg-slab" : w.zero ? "bg-chart-mark" : "bg-text-muted";
        const h = w.zero ? "2px" : `calc((100% - ${top}px) * ${value(w) / vMax})`;
        return <div key={w.x0} className={`absolute bottom-0 ${color}`} style={{ left, width, height: h }} />;
      })}
    </div>
  );

  return (
    <div
      className="relative flex flex-col gap-2 touch-pan-y"
      aria-hidden="true"
      onPointerMove={pick}
      onPointerDown={pick}
      onPointerLeave={() => setActive(null)}
    >
      {strip("Timer", "t", 26, (w) => w.hours, hMax)}
      {strip("Belastning", "TSS", 26, (w) => w.load, lMax)}
      <div className="relative h-[30px]">
        {ticks.map((t, i) => (
          <span
            key={t.x}
            className="absolute top-1 text-12 font-medium whitespace-nowrap text-text-muted tabular-nums"
            style={{
              left: xCss(axis, t.x),
              transform: i === 0 ? undefined : axis.hi - t.x < 30 ? "translateX(-100%)" : "translateX(-50%)",
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
      <SeamOverlay axis={axis} bottom={X_AXIS_HEIGHT} />
      {active !== null && (
        <div className="pointer-events-none absolute top-6 left-10 z-10">
          <TipBox lines={active.tip} />
        </div>
      )}
    </div>
  );
}
