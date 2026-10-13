"use client";

import { ComposedChart, CartesianGrid, Line, ReferenceDot, XAxis, YAxis } from "recharts";

import { type BlockSpan, E1RM_PANELS_HEIGHT, type E1rmPanel, type StrengthWeek } from "@/lib/analyse-styrke-view";
import { type AxisTick, type ChartRow, chartRows, formatEf, type LineChartView, type Seam, seamReadout, type WeekBar } from "@/lib/analyse-view";
import { gapSeam, highestAt, nearestIndex, type Readout, restingReadout, restingWeekIndex, xAtPointer } from "@/lib/chart-readout";
import { formatLoad } from "@/lib/format";
import { LIFT_NAME, LIFTS, type StrengthLift } from "@/lib/lifts";

import { ChartReadout, Marker, PLOT_FOCUS, PointerTip, ReadoutSpace, useChartPick } from "./ChartReadout";
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
              className="absolute top-0 z-[1] w-px"
              style={{
                left: xCss(axis, x),
                bottom,
                backgroundImage: "repeating-linear-gradient(to bottom, var(--chart-mark) 0 3px, transparent 3px 6px)",
              }}
            />
          ))}
          <div
            className="@container absolute top-0 z-[1] flex h-[18px] items-center justify-center overflow-hidden"
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

type DotProps = { readonly cx?: number; readonly cy?: number; readonly payload?: ChartRow; readonly value?: unknown };

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
  // One row per mark (two rides on one day keep both); segment keys s0..sN carry the line.
  const rows = chartRows(chart, variant);
  const xs = rows.map((r) => r.x);
  // Two rides on one day: the readout and ring show the one with the highest value (eFTP or EF).
  const ys = rows.map((r) => (r.marks[0]?.excluded === false ? r.marks[0].y : null));
  const latestIndex = Math.max(rows.findLastIndex((r) => r.marks.some((m) => m.latest)), rows.findLastIndex((r) => r.marks.some((m) => !m.excluded)));
  const { pick, plotProps } = useChartPick({
    count: rows.length,
    startIndex: latestIndex,
    indexAt: (clientX, box) => {
      const x = xAtPointer(clientX, box, { left: Y_AXIS_WIDTH, right: MARGIN_RIGHT }, axis);
      const i = nearestIndex(xs, x);
      if (i < 0) return null;
      // DESIGN.md "Gaps": far from every ride and inside an "Ingen ture" seam, the marker stays at the tap.
      return gapSeam(x, xs[i], axis.seams) >= 0 ? { index: i, x } : highestAt(xs, ys, i);
    },
  });
  if (!hydrated)
    return (
      <>
        <Skeleton height="h-(--chart-height)" />
        <ReadoutSpace lines={3} cells />
      </>
    );
  const ticks = wide ? axis.ticksWide : axis.ticksNarrow;
  const gapX = pick?.x;
  const seam = gapX === undefined ? undefined : axis.seams[gapSeam(gapX, undefined, axis.seams)];
  const picked = pick === null || seam !== undefined ? undefined : rows[pick.index];
  const pickedMark = picked?.marks[0];
  const latestMark = latestIndex < 0 ? undefined : rows[latestIndex]?.marks[0];
  const pickedReadout = seam !== undefined ? seamReadout(seam) : pickedMark?.readout;
  const markerX = seam !== undefined && gapX !== undefined ? xCss(axis, gapX) : picked === undefined ? null : xCss(axis, picked.x);
  const resting = restingReadout(latestMark?.readout ?? null, "Tryk på grafen for at se en tur");
  const readout: Readout = pickedReadout !== undefined && pick?.mode !== "mouse" ? pickedReadout : resting;
  const all = [resting, ...axis.seams.map(seamReadout), ...rows.flatMap((r) => r.marks.map((m) => m.readout))];
  const ringY = pickedMark === undefined ? null : pickedMark.excluded ? chart.domain[0] : pickedMark.y;
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
    <>
    <div
      {...plotProps}
      aria-label={`${title}. Piletaster vælger en tur`}
      className={`relative h-(--chart-height) w-full ${PLOT_FOCUS}`}
    >
      {markerX !== null && <Marker left={markerX} bottom={X_AXIS_HEIGHT} />}
      {pickedReadout !== undefined && markerX !== null && pick?.mode === "mouse" && (
        <PointerTip readout={pickedReadout} left={markerX} rightInset={MARGIN_RIGHT} />
      )}
      <ComposedChart
        responsive
        style={{ width: "100%", height: "100%" }}
        data={rows}
        margin={{ top: SEAM_ROOM, right: MARGIN_RIGHT, bottom: 0, left: 0 }}
        title={title}
        accessibilityLayer={false}
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
        {picked !== undefined && ringY !== null && (
          <ReferenceDot x={picked.x} y={ringY} r={4} fill="var(--text)" stroke="var(--surface)" strokeWidth={2} ifOverflow="visible" />
        )}
      </ComposedChart>
      <SeamOverlay axis={axis} bottom={X_AXIS_HEIGHT} />
    </div>
    <ChartReadout readout={readout} all={all} lines={3} cells />
    </>
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
 * at the resting week: the current one, or Cykel's latest week with rides), Esc closes the
 * tooltip. Draws the x labels once, under the last child.
 */
function WeekGroup<W extends PickWeek>({
  axis,
  weeks,
  ticks,
  readout,
  lines,
  cells,
  overlay,
  padTop = 0,
  hasData,
  children,
}: {
  readonly axis: XDomain;
  readonly weeks: readonly W[];
  readonly ticks: readonly AxisTick[];
  readonly readout: (w: W) => Readout;
  readonly lines: number;
  readonly cells: boolean;
  readonly overlay: React.ReactNode;
  readonly padTop?: number;
  readonly hasData?: (w: W) => boolean; // rest on the latest week with data (Cykel: a week with rides)
  readonly children: (active: W | null) => React.ReactNode;
}) {
  const latestIndex = restingWeekIndex(weeks, hasData);
  const { pick, plotProps } = useChartPick({
    count: weeks.length,
    startIndex: latestIndex,
    indexAt: (clientX, box) => {
      const x = xAtPointer(clientX, box, { left: Y_AXIS_WIDTH, right: MARGIN_RIGHT }, axis);
      const i = weeks.findIndex((w) => w.x0 <= x && x < w.x1);
      return i < 0 ? null : i;
    },
  });
  const active = pick === null ? null : (weeks[pick.index] ?? null);
  const latest = latestIndex < 0 ? undefined : weeks[latestIndex];
  const markerX = active === null ? null : xCss(axis, (active.x0 + active.x1) / 2);
  const resting = restingReadout(latest === undefined ? null : readout(latest), "Tryk på grafen for at se en uge");
  const shown = active !== null && pick?.mode !== "mouse" ? readout(active) : resting;
  const all = [resting, ...weeks.map(readout)];

  return (
    <div className="flex flex-col gap-2">
      <div
        {...plotProps}
        className={`relative flex flex-col gap-2 ${PLOT_FOCUS}`}
        style={{ ...plotProps.style, ...(padTop > 0 ? { paddingTop: padTop } : {}) }}
        aria-label="Uger. Piletaster vælger en uge"
      >
        {overlay}
        {markerX !== null && <Marker left={markerX} bottom={X_AXIS_HEIGHT} />}
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
        {active !== null && markerX !== null && pick?.mode === "mouse" && (
          <PointerTip readout={readout(active)} left={markerX} rightInset={MARGIN_RIGHT} />
        )}
      </div>
      <ChartReadout readout={shown} all={all} lines={lines} cells={cells} />
    </div>
  );
}

type StripBar = {
  readonly x0: number;
  readonly x1: number;
  readonly value: number | null; // null = no row ("mangler"): no bar, never a 0 tick
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
          if (w.value === null) return null;
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
      readout={(w) => w.readout}
      lines={3}
      cells
      overlay={<SeamOverlay axis={axis} bottom={X_AXIS_HEIGHT} />}
      hasData={(w) => !w.zero}
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

function E1rmPlot({ axis, panel }: { readonly axis: XDomain; readonly panel: E1rmPanel }) {
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
                    className="absolute size-[16px] -translate-1/2 rounded-full border-2 border-text"
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
                className={`absolute -translate-1/2 rounded-full ${p.logged ? "size-[10px] bg-text" : "size-[7px] bg-chart-mark"}`}
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
  if (!hydrated) return <Skeleton height={E1RM_PANELS_HEIGHT} />;
  return (
    <WeekGroup
      axis={axis}
      weeks={weeks}
      ticks={wide ? axis.ticksWide : axis.ticksNarrow}
      readout={(w) => ({ head: w.head, cells: [], facts: w.e1rmTip, factTone: "text" })}
      lines={4}
      cells={false}
      overlay={<BlockOverlay axis={axis} blocks={blocks} phaseRules={phaseRules} />}
      padTop={BLOCK_ROOM}
    >
      {() => panels.map((p) => <E1rmPlot key={p.lift} axis={axis} panel={p} />)}
    </WeekGroup>
  );
}

type TonnageProps = StrengthProps & { readonly max: Readonly<Record<StrengthLift, number>> };

export function TonnageStrips(props: TonnageProps) {
  return (
    <ChartBoundary what={CHART_FAILED}>
      <TonnageStripsInner {...props} />
    </ChartBoundary>
  );
}

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
      readout={(w) => ({ head: w.head, cells: [], facts: w.tonnageTip, factTone: "text" })}
      lines={4}
      cells={false}
      overlay={<BlockOverlay axis={axis} blocks={blocks} phaseRules={phaseRules} />}
      padTop={BLOCK_ROOM}
    >
      {(active) =>
        LIFTS.map((lift) => (
          <Strip
            key={lift}
            axis={axis}
            label={LIFT_NAME[lift]}
            unit="kg"
            height={TONNAGE_STRIP}
            max={max[lift]}
            bars={weeks.map((w) => ({
              x0: w.x0,
              x1: w.x1,
              value: w.tonnage[lift],
              zero: w.tonnage[lift] === 0,
              current: w.current,
              active: w === active,
            }))}
          />
        ))
      }
    </WeekGroup>
  );
}
