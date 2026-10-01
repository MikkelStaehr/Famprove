"use client";

import { useState } from "react";
import { ComposedChart, CartesianGrid, Line, Tooltip, XAxis, YAxis } from "recharts";

import type { BlockSpan, E1rmPanel, StrengthWeek } from "@/lib/analyse-styrke-view";
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
function xCss(axis: { readonly lo: number; readonly hi: number }, x: number): string {
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

// --- weekly strips (analyse.md §5d, analyse-styrke.md §5) ----------------------------------

type XDomain = { readonly lo: number; readonly hi: number };
type PickWeek = { readonly x0: number; readonly x1: number; readonly current: boolean };
// 200 % text: tick labels keep TICK's fixed px size (the 12px exception, analyse.md §8).
const tickStyle = { fontSize: TICK.fontSize } as const;
const STRIP_TOP = 8; // room for the max label inside a strip
const BLOCK_ROOM = 18; // the block-label strip on top (analyse-styrke.md §5)

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((s) => s * p >= v) ?? 10) * p;
}

/**
 * One focusable group per card (analyse.md §5d): tap or pointer picks a week, ←/→ step (starting
 * at the current one), Esc closes the tooltip. Draws the x labels once, under the last child.
 */
function WeekGroup<W extends PickWeek>({
  axis,
  weeks,
  ticks,
  tip,
  overlay,
  padTop = 0,
  children,
}: {
  readonly axis: XDomain;
  readonly weeks: readonly W[];
  readonly ticks: readonly AxisTick[];
  readonly tip: (w: W) => readonly string[];
  readonly overlay: React.ReactNode;
  readonly padTop?: number;
  readonly children: (active: W | null) => React.ReactNode;
}) {
  const [active, setActive] = useState<W | null>(null);

  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - box.left - Y_AXIS_WIDTH) / (box.width - Y_AXIS_WIDTH - MARGIN_RIGHT);
    const x = axis.lo + f * (axis.hi - axis.lo);
    setActive(weeks.find((w) => w.x0 <= x && x < w.x1) ?? null);
  };

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      setActive(null);
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    if (active === null) {
      setActive(weeks.find((w) => w.current) ?? weeks[weeks.length - 1] ?? null);
      return;
    }
    const i = weeks.indexOf(active) + (e.key === "ArrowLeft" ? -1 : 1);
    setActive(weeks[Math.max(0, Math.min(weeks.length - 1, i))] ?? null);
  };

  return (
    <div
      className="relative flex touch-pan-y flex-col gap-2 rounded-control focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus"
      style={padTop > 0 ? { paddingTop: padTop } : undefined}
      tabIndex={0}
      role="group"
      aria-label="Uger. Piletaster vælger en uge"
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
      onPointerMove={pick}
      onPointerDown={pick}
      // Touch fires pointerleave right after the tap: only a mouse leaving clears (blur does on touch).
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setActive(null);
      }}
    >
      {overlay}
      {children(active)}
      <div className="relative h-[30px]" aria-hidden="true">
        {ticks.map((t, i) => (
          <span
            key={t.x}
            className="absolute top-1 font-medium whitespace-nowrap text-text-muted tabular-nums"
            style={{
              ...tickStyle,
              left: xCss(axis, t.x),
              transform: i === 0 ? undefined : axis.hi - t.x < 30 ? "translateX(-100%)" : "translateX(-50%)",
            }}
          >
            {t.label}
          </span>
        ))}
      </div>
      {active !== null && (
        <div className="pointer-events-none absolute top-6 left-10 z-10" role="status">
          <TipBox lines={tip(active)} />
        </div>
      )}
    </div>
  );
}

type StripBar = {
  readonly x0: number;
  readonly x1: number;
  readonly value: number;
  readonly zero: boolean;
  readonly current: boolean;
  readonly active: boolean;
};

/** One bar strip from 0 to niceMax: a bar per week, a 2px zero tick for a zero week, --slab for the current week. */
function Strip({
  axis,
  label,
  unit,
  height,
  bars,
  max,
}: {
  readonly axis: XDomain;
  readonly label: string;
  readonly unit: string;
  readonly height: number;
  readonly bars: readonly StripBar[];
  readonly max: number;
}) {
  const vMax = niceMax(max);
  return (
    <div className="flex flex-col gap-1">
      <p className="relative text-14 font-semibold" aria-hidden="true" style={{ marginLeft: Y_AXIS_WIDTH }}>
        {label} <span className="font-normal text-text-muted">{unit}</span>
      </p>
      <div className="relative" style={{ height }} aria-hidden="true">
        <div className="absolute border-b border-border" style={{ left: Y_AXIS_WIDTH, right: MARGIN_RIGHT, bottom: 0 }} />
        <div className="absolute border-t border-border" style={{ left: Y_AXIS_WIDTH, right: MARGIN_RIGHT, top: STRIP_TOP }} />
        <span
          className="absolute left-0 font-medium leading-none text-text-muted tabular-nums"
          style={{ ...tickStyle, top: STRIP_TOP - 6 }}
        >
          {vMax.toLocaleString("da-DK")}
        </span>
        <span className="absolute bottom-0 left-0 font-medium leading-none text-text-muted" style={tickStyle}>
          0
        </span>
        {bars.map((w) => {
          const left = xCss(axis, w.x0);
          const width = `calc(${xCss(axis, w.x1)} - ${xCss(axis, w.x0)} - 1px)`;
          const color = w.current ? "bg-slab" : w.zero ? "bg-chart-mark" : "bg-text-muted";
          const h = w.zero ? "2px" : `calc((100% - ${STRIP_TOP}px) * ${w.value / vMax})`;
          const ring = w.active ? " outline outline-1 outline-text" : "";
          return <div key={w.x0} className={`absolute bottom-0 ${color}${ring}`} style={{ left, width, height: h }} />;
        })}
      </div>
    </div>
  );
}

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

function WeekStripsInner({ axis, weeks, max }: WeeksProps) {
  const hydrated = useHydrated();
  const wide = useWide();
  if (!hydrated) return <Skeleton height="h-[232px]" />;
  const ticks = wide ? axis.ticksWide : axis.ticksNarrow;
  const bars = (active: WeekBar | null, value: (w: WeekBar) => number): StripBar[] =>
    weeks.map((w) => ({ x0: w.x0, x1: w.x1, value: value(w), zero: w.zero, current: w.current, active: w === active }));
  return (
    <WeekGroup
      axis={axis}
      weeks={weeks}
      ticks={ticks}
      tip={(w) => w.tip}
      overlay={<SeamOverlay axis={axis} bottom={X_AXIS_HEIGHT} />}
    >
      {(active) => (
        <>
          <Strip axis={axis} label="Timer" unit="t" height={STRIP} bars={bars(active, (w) => w.hours)} max={max.hours} />
          <Strip axis={axis} label="Belastning" unit="TSS" height={STRIP} bars={bars(active, (w) => w.load)} max={max.load} />
        </>
      )}
    </WeekGroup>
  );
}

// --- /analyse/styrke (analyse-styrke.md §5) ------------------------------------------------

type StrengthAxis = XDomain & { readonly ticksNarrow: readonly AxisTick[]; readonly ticksWide: readonly AxisTick[] };
const HATCH = "repeating-linear-gradient(45deg, var(--chart-mark) 0 1.5px, transparent 1.5px 6px)";

/** Block ruler (§5): --block-fill spans, deload hatch, "Blok 11" labels in the top strip, phase rules. aria-hidden. */
function BlockOverlay({
  axis,
  blocks,
  phaseRules,
}: {
  readonly axis: XDomain;
  readonly blocks: readonly BlockSpan[];
  readonly phaseRules: readonly number[];
}) {
  const span = (x0: number, x1: number) => ({ left: xCss(axis, x0), width: `calc(${xCss(axis, x1)} - ${xCss(axis, x0)})` });
  return (
    <div aria-hidden="true">
      {blocks.map((b) => (
        <div key={b.x0}>
          <div className="absolute bg-block-fill" style={{ ...span(b.x0, b.x1), top: BLOCK_ROOM, bottom: X_AXIS_HEIGHT }} />
          {b.deloadX0 !== null && (
            <div
              className="absolute bg-block-fill"
              style={{ ...span(b.deloadX0, b.x1), top: BLOCK_ROOM, bottom: X_AXIS_HEIGHT, backgroundImage: HATCH }}
            />
          )}
          <div
            className="@container absolute top-0 flex h-[18px] items-center justify-center overflow-hidden"
            style={span(b.x0, b.x1)}
          >
            {/* Omitted (not clipped) when the span is narrower than the label. */}
            <span className="hidden font-semibold whitespace-nowrap text-text @[3.5rem]:inline" style={tickStyle}>
              {b.label}
            </span>
          </div>
        </div>
      ))}
      {phaseRules.map((x) => (
        <div
          key={x}
          className="absolute z-[1] w-[1.5px] -translate-x-1/2 bg-text-muted"
          style={{ left: xCss(axis, x), top: BLOCK_ROOM, bottom: X_AXIS_HEIGHT }}
        />
      ))}
    </div>
  );
}

const PANEL = 120;
const HEADROOM = 16; // room for the block-best labels

function E1rmPlot({
  axis,
  panel,
  active,
}: {
  readonly axis: XDomain;
  readonly panel: E1rmPanel;
  readonly active: StrengthWeek | null;
}) {
  const [d0, d1] = panel.domain;
  const f = (v: number) => (v - d0) / (d1 - d0);
  const top = (v: number) => `calc(${HEADROOM}px + (100% - ${HEADROOM}px) * ${1 - f(v)})`;
  const sx = (x: number) => ((x - axis.lo) / (axis.hi - axis.lo)) * 1000;
  return (
    <div className="flex flex-col gap-1">
      <p className="relative text-14 font-semibold" aria-hidden="true" style={{ marginLeft: Y_AXIS_WIDTH }}>
        {panel.name} <span className="font-normal text-text-muted">kg</span>
      </p>
      {panel.empty !== null ? (
        <p
          className="relative flex items-center text-14 text-text-muted"
          style={{ height: PANEL, marginLeft: Y_AXIS_WIDTH }}
        >
          {panel.empty}
        </p>
      ) : (
        <div className="relative" style={{ height: PANEL }} aria-hidden="true">
          {panel.ticks.map((t) => (
            <div key={t}>
              <div
                className="absolute border-t border-border"
                style={{ left: Y_AXIS_WIDTH, right: MARGIN_RIGHT, top: top(t) }}
              />
              <span
                className="absolute left-0 -translate-y-1/2 font-medium leading-none text-text-muted tabular-nums"
                style={{ ...tickStyle, top: top(t) }}
              >
                {t.toLocaleString("da-DK")}
              </span>
            </div>
          ))}
          {active !== null && (
            <div
              className="absolute w-px bg-text-muted"
              style={{ left: xCss(axis, (active.x0 + active.x1) / 2), top: HEADROOM, bottom: 0 }}
            />
          )}
          {panel.sheet.map((s) => (
            <div key={s.x0}>
              <div
                className="absolute h-[1.5px] -translate-y-1/2"
                style={{
                  left: xCss(axis, s.x0),
                  width: `calc(${xCss(axis, s.x1)} - ${xCss(axis, s.x0)})`,
                  top: top(s.y),
                  backgroundImage: "repeating-linear-gradient(to right, var(--text-muted) 0 6px, transparent 6px 10px)",
                }}
              />
              <span
                className="absolute -translate-x-full rounded-sm bg-surface px-0.5 font-medium leading-none text-text-muted tabular-nums"
                style={{ ...tickStyle, left: xCss(axis, s.x1), top: `calc(${top(s.y)} - 14px)` }}
              >
                {s.label}
              </span>
            </div>
          ))}
          <svg
            className="absolute overflow-visible"
            style={{
              left: Y_AXIS_WIDTH,
              top: HEADROOM,
              width: `calc(100% - ${Y_AXIS_WIDTH + MARGIN_RIGHT}px)`,
              height: `calc(100% - ${HEADROOM}px)`,
            }}
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
          >
            {panel.segments.map((seg) => (
              <polyline
                key={seg[0]?.x}
                points={seg.map((p) => `${sx(p.x)},${(1 - f(p.y)) * 1000}`).join(" ")}
                fill="none"
                stroke="var(--text-muted)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            ))}
          </svg>
          {panel.points.map((p) => (
            <div key={p.x}>
              {p.best && (
                <>
                  <span
                    className="absolute size-4 -translate-1/2 rounded-full border-2 border-text"
                    style={{ left: xCss(axis, p.x), top: top(p.y) }}
                  />
                  <span
                    className="absolute -translate-x-1/2 font-semibold leading-none text-text tabular-nums"
                    style={{ ...tickStyle, left: xCss(axis, p.x), top: `calc(${top(p.y)} ${p.labelBelow ? "+ 10px" : "- 22px"})` }}
                  >
                    {p.label}
                  </span>
                </>
              )}
              <span
                className={`absolute -translate-1/2 rounded-full ${p.logged ? "size-2.5 bg-text" : "size-[7px] bg-chart-mark"}`}
                style={{ left: xCss(axis, p.x), top: top(p.y) }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type StrengthProps = {
  readonly axis: StrengthAxis;
  readonly blocks: readonly BlockSpan[];
  readonly phaseRules: readonly number[];
  readonly weeks: readonly StrengthWeek[];
};

type PanelsProps = StrengthProps & { readonly panels: readonly E1rmPanel[] };

export function E1rmPanels(props: PanelsProps) {
  return (
    <ChartBoundary what={CHART_FAILED}>
      <E1rmPanelsInner {...props} />
    </ChartBoundary>
  );
}

function E1rmPanelsInner({ axis, blocks, phaseRules, weeks, panels }: PanelsProps) {
  const hydrated = useHydrated();
  const wide = useWide();
  if (!hydrated) return <Skeleton height="h-[492px]" />;
  return (
    <WeekGroup
      axis={axis}
      weeks={weeks}
      ticks={wide ? axis.ticksWide : axis.ticksNarrow}
      tip={(w) => [w.head, ...w.e1rmTip]}
      overlay={<BlockOverlay axis={axis} blocks={blocks} phaseRules={phaseRules} />}
      padTop={BLOCK_ROOM}
    >
      {(active) => panels.map((p) => <E1rmPlot key={p.lift} axis={axis} panel={p} active={active} />)}
    </WeekGroup>
  );
}

type TonnageProps = StrengthProps & { readonly max: readonly number[] };

export function TonnageStrips(props: TonnageProps) {
  return (
    <ChartBoundary what={CHART_FAILED}>
      <TonnageStripsInner {...props} />
    </ChartBoundary>
  );
}

const LIFT_LABELS = ["Squat", "Bænkpres", "Dødløft"] as const;
const TONNAGE_STRIP = 80;

function TonnageStripsInner({ axis, blocks, phaseRules, weeks, max }: TonnageProps) {
  const hydrated = useHydrated();
  const wide = useWide();
  if (!hydrated) return <Skeleton height="h-[372px]" />;
  return (
    <WeekGroup
      axis={axis}
      weeks={weeks}
      ticks={wide ? axis.ticksWide : axis.ticksNarrow}
      tip={(w) => [w.head, ...w.tonnageTip]}
      overlay={<BlockOverlay axis={axis} blocks={blocks} phaseRules={phaseRules} />}
      padTop={BLOCK_ROOM}
    >
      {(active) =>
        LIFT_LABELS.map((label, i) => (
          <Strip
            key={label}
            axis={axis}
            label={label}
            unit="kg"
            height={TONNAGE_STRIP}
            max={max[i] ?? 0}
            bars={weeks.map((w) => ({
              x0: w.x0,
              x1: w.x1,
              value: w.tonnage[i] ?? 0,
              zero: (w.tonnage[i] ?? 0) === 0,
              current: w.current,
              active: w === active,
            }))}
          />
        ))
      }
    </WeekGroup>
  );
}
