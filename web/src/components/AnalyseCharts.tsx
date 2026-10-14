"use client";

import { CartesianGrid, ComposedChart, Line, ReferenceDot, XAxis, YAxis } from "recharts";

import { type BlockSpan, E1RM_PANELS_HEIGHT, type E1rmPanel, type StrengthWeek } from "@/lib/analyse-styrke-view";
import { type AxisTick, type ChartRow, chartRows, eftpDots, formatEf, type LineChartView, type Mark, type Seam, seamReadout, slotCentre, type WeekBar } from "@/lib/analyse-view";
import { AMARKS, dashGradient, hatchGradient, isDeloadWeek, tickAnchor, ticksClearOfToday } from "@/lib/analyse-marks";
import { MARKS } from "@/lib/chart-marks";
import { gapSeam, highestAt, nearestIndex, type Readout, restingReadout, restingWeekIndex, xAtPointer } from "@/lib/chart-readout";
import { formatLoad } from "@/lib/format";
import { LIFT_NAME, LIFTS, type StrengthLift } from "@/lib/lifts";

import { ChartBoundary, useHydrated, useWide, useWidth } from "./chart-hooks";
import { HollowDot } from "./ChartMarks";
import { ChartReadout, Marker, PLOT_FOCUS, PointerTip, ReadoutSpace, useChartPick } from "./ChartReadout";

/**
 * /analyse charts (design/specs/analyse.md §4-§5). One x domain [lo, hi] for all three, the pause
 * seams drawn the same way in each, no motion. Plots the view model's values as-is.
 */

// Ember (reset-analyse-cykel.md §4, C): no left axis, the plot runs from the card's left edge; the
// y labels are right-aligned in a 36px column at the right edge, centred on their gridlines, so the
// today line (today = the domain's right end) never runs through them. Every card uses the same
// two numbers, so dates, seams and the today line align down the page.
const Y_AXIS_WIDTH = 0;
const MARGIN_RIGHT = 36;
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

/** Axis labels: Geist Mono 11 muted, tabular (DESIGN.md Part B "Chart marks"). */
const TICK = { fill: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" } as const;

function Skeleton({ height }: { readonly height: string }) {
  return <div className={`${height} w-full rounded-control bg-track motion-safe:animate-pulse`} />;
}

/**
 * Today (reset-analyse-cykel.md §4): a 1.5px --today line the full plot height at today's x (a 1px
 * --card halo each side, so it reads orange where it crosses the current week's --text bar), with
 * `I DAG` Geist Mono 11 in --today (4.91:1 on --card) under it, end-anchored 4px left of the line.
 * HTML so it shares xCss with the seams and strips, the same x in every card; aria-hidden.
 */
function TodayLine({ axis, x, top = 0 }: { readonly axis: { readonly lo: number; readonly hi: number }; readonly x: number; readonly top?: number }) {
  const t = AMARKS.today;
  return (
    <div aria-hidden="true" data-mark="today">
      {/* Through the plot and the x-label row; the label sits under the tick labels, left of the line. */}
      <div
        className="pointer-events-none absolute bottom-0 z-[2]"
        style={{ left: `calc(${xCss(axis, x)} - ${t.width / 2}px)`, top, width: t.width, background: t.color, boxShadow: "0 0 0 1px var(--card)" }}
      />
      <span
        className="pointer-events-none absolute bottom-0 z-[2] -translate-x-full font-mono text-11 leading-none whitespace-nowrap text-today"
        style={{ left: `calc(${xCss(axis, x)} - ${t.labelGap}px)` }}
      >
        I DAG
      </span>
    </div>
  );
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
                backgroundImage: dashGradient("to bottom", AMARKS.seam.color, AMARKS.seam.on, AMARKS.seam.off),
              }}
            />
          ))}
          <div
            className="@container absolute top-0 z-[1] flex h-[18px] items-center justify-center overflow-hidden"
            style={{ left: xCss(axis, s.x0), width: `calc(${xCss(axis, s.x1)} - ${xCss(axis, s.x0)})` }}
          >
            {/* Omitted (not clipped) when the run is narrower than the label. */}
            <span className="hidden font-mono text-11 whitespace-nowrap text-text-muted uppercase @[5.5rem]:inline">Ingen ture</span>
          </div>
        </div>
      ))}
    </>
  );
}

type TickProps = { readonly x?: number | string; readonly y?: number | string; readonly payload?: { readonly value?: unknown } };

/** An x label; one not in `shown` (it would reach the `I DAG` caption, or the plot isn't measured yet) draws nothing. */
function DateTick({
  x,
  y,
  payload,
  ticks,
  shown,
  hi,
}: TickProps & { readonly ticks: readonly AxisTick[]; readonly shown: ReadonlySet<number>; readonly hi: number }) {
  const value = payload?.value;
  const index = ticks.findIndex((t) => t.x === value);
  const tick = ticks[index];
  if (tick === undefined || !shown.has(tick.x)) return <g />;
  const anchor = tickAnchor(index, tick.x, hi);
  return (
    <text x={Number(x)} y={Number(y)} dy={12} textAnchor={anchor} {...TICK}>
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
  const [widthRef, boxWidth] = useWidth();
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
  // Today = the domain's last day (analyse-view: hi = today + 0.5); the same x in all three cards.
  const todayX = axis.hi - 0.5;
  // No label at today: one reaching the `I DAG` caption is skipped; none before the plot is measured.
  const plotWidth = boxWidth === null ? null : boxWidth - Y_AXIS_WIDTH - MARGIN_RIGHT;
  const shownTicks = new Set(
    plotWidth === null ? [] : ticksClearOfToday(ticks, { lo: axis.lo, hi: axis.hi, today: todayX, width: plotWidth }).map((t) => t.x),
  );
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

  // instrument-analyse.md §2: eFTP dots sized by TSS (filled ink; null load = hollow ring), the
  // latest ride ringed in --bg; EF rides muted dots, the 28-day trend small ink dots. No lines.
  const dots = variant === "eftp" ? eftpDots(chart) : [];
  const dotOf = new Map<Mark, { readonly r: number; readonly hollow: boolean } | null>(chart.marks.map((m, i) => [m, dots[i] ?? null]));
  const none = (k: string) => <g key={k} />;
  const eftpShape = ({ cx, cy, payload, value }: DotProps) => {
    const mark = payload?.marks[0];
    if (typeof value !== "number" || cx === undefined || cy === undefined || mark === undefined) return none(`${cx}-${cy}`);
    const d = dotOf.get(mark) ?? null;
    if (d === null) return none(`${cx}-${cy}`);
    if (mark.latest) {
      const l = AMARKS.latest;
      return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={l.r} fill={l.fill} stroke={l.color} strokeWidth={l.stroke} />;
    }
    if (d.hollow) return <HollowDot key={`${cx}-${cy}`} cx={cx} cy={cy} r={d.r} stroke={MARKS.eftpDot.fill} strokeWidth={MARKS.eftpDot.missing.stroke} />;
    return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={d.r} fill={AMARKS.line.color} />;
  };
  const crossShape = ({ cx, cy, value }: DotProps) => {
    if (typeof value !== "number" || cx === undefined || cy === undefined) return none(`${cx}-e`);
    const c = AMARKS.cross;
    const h = c.size / 2;
    const y = cy - h;
    return (
      <path
        key={`${cx}-e`}
        d={`M${cx - h} ${y - h}L${cx + h} ${y + h}M${cx + h} ${y - h}L${cx - h} ${y + h}`}
        stroke={c.color}
        strokeWidth={c.width}
        fill="none"
      />
    );
  };
  const efDot = ({ cx, cy, value }: DotProps) =>
    typeof value !== "number" || cx === undefined || cy === undefined ? (
      none(`${cx}-d`)
    ) : (
      <circle key={`${cx}-${cy}-d`} cx={cx} cy={cy} r={AMARKS.efRide.r} fill={AMARKS.efRide.color} />
    );
  return (
    <>
    <div
      {...plotProps}
      aria-label={`${title}. Piletaster vælger en tur`}
      className={`relative h-(--chart-height) w-full ${PLOT_FOCUS}`}
    >
      <div ref={widthRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />
      {markerX !== null && <Marker left={markerX} bottom={X_AXIS_HEIGHT} />}
      {pickedReadout !== undefined && markerX !== null && pick?.mode === "mouse" && (
        <PointerTip readout={pickedReadout} left={markerX} rightInset={MARGIN_RIGHT} />
      )}
      <ComposedChart
        responsive
        style={{ width: "100%", height: "100%" }}
        data={rows}
        margin={{ top: SEAM_ROOM, right: 0, bottom: 0, left: 0 }}
        title={title}
        accessibilityLayer={false}
      >
        <XAxis
          dataKey="x"
          type="number"
          domain={[axis.lo, axis.hi]}
          ticks={ticks.map((t) => t.x)}
          interval={0}
          height={X_AXIS_HEIGHT}
          tick={(p: TickProps) => <DateTick {...p} ticks={ticks} shown={shownTicks} hi={axis.hi} />}
          tickLine={false}
          axisLine={false}
        />
        {/* C: dashed --border gridlines at the y ticks, no axis lines, y labels inside the right edge. */}
        <CartesianGrid vertical={false} stroke={AMARKS.grid.color} strokeDasharray={AMARKS.grid.dash} />
        <YAxis
          orientation="right"
          width={MARGIN_RIGHT}
          domain={[chart.domain[0], chart.domain[1]]}
          ticks={[...chart.ticks]}
          tickSize={0}
          tickMargin={0}
          tick={(p: TickProps) => (
            <text x={Number(p.x) + MARGIN_RIGHT} y={Number(p.y)} textAnchor="end" dominantBaseline="central" {...TICK}>
              {typeof p.payload?.value === "number" ? format(p.payload.value) : ""}
            </text>
          )}
          tickLine={false}
          axisLine={false}
        />
        {variant === "ef" && (
          <Line dataKey="dots" stroke="none" dot={efDot} activeDot={false} isAnimationActive={false} legendType="none" />
        )}
        {/* One segment per run: the 2px --text line breaks after > 21 days (eftpGapBefore / efGapBefore).
            eFTP draws its TSS-sized dots on it; the EF trend is the line alone. */}
        {segKeys.map((k) => (
          <Line
            key={k}
            dataKey={k}
            type="linear"
            stroke={AMARKS.line.color}
            strokeWidth={AMARKS.line.width}
            strokeLinejoin="round"
            dot={variant === "eftp" ? eftpShape : false}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
            connectNulls={false}
          />
        ))}
        <Line dataKey="excl" stroke="none" dot={crossShape} activeDot={false} isAnimationActive={false} legendType="none" />
        {picked !== undefined && ringY !== null && (
          <ReferenceDot x={picked.x} y={ringY} r={4} fill="none" stroke="var(--text)" strokeWidth={1} ifOverflow="visible" />
        )}
      </ComposedChart>
      <SeamOverlay axis={axis} bottom={X_AXIS_HEIGHT} />
      <TodayLine axis={axis} x={todayX} />
    </div>
    <ChartReadout readout={readout} all={all} lines={3} cells />
    </>
  );
}

// --- weekly strips (analyse.md §5d, analyse-styrke.md §5) ----------------------------------

type XDomain = { readonly lo: number; readonly hi: number };
type PickWeek = { readonly x0: number; readonly x1: number; readonly current: boolean };
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
  todayX,
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
  /**
   * Today's day number: the --today line runs through every strip. Omitted: no today line (Styrke,
   * user 2026-10-14: on weekly charts it was a lone tick without a date).
   */
  readonly todayX?: number;
}) {
  const latestIndex = restingWeekIndex(weeks, hasData);
  const [widthRef, boxWidth] = useWidth();
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
  const markerX = active === null ? null : xCss(axis, slotCentre(active));
  const resting = restingReadout(latest === undefined ? null : readout(latest), "Tryk på grafen for at se en uge");
  const shown = active !== null && pick?.mode !== "mouse" ? readout(active) : resting;
  const all = [resting, ...weeks.map(readout)];
  // No label at today: one reaching the `I DAG` caption is skipped; none before the row is measured.
  const shownTicks =
    boxWidth === null
      ? []
      : ticksClearOfToday(ticks, { lo: axis.lo, hi: axis.hi, today: todayX ?? null, width: boxWidth - Y_AXIS_WIDTH - MARGIN_RIGHT });

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
        {todayX !== undefined && <TodayLine axis={axis} x={todayX} />}
        <div ref={widthRef} className="relative h-[30px]" aria-hidden="true">
          {shownTicks.map((t) => {
            const anchor = tickAnchor(ticks.indexOf(t), t.x, axis.hi);
            return (
              <span
                key={t.x}
                className="absolute top-1 font-mono text-11 whitespace-nowrap text-text-muted"
                style={{
                  left: xCss(axis, t.x),
                  transform: anchor === "start" ? undefined : anchor === "end" ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {t.label}
              </span>
            );
          })}
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
  readonly deload?: boolean;
};

/**
 * One bar strip from 0 to niceMax (reset-analyse-cykel.md §4c, B's bars): label MonoCaption 11 left,
 * the max label right; a week = a solid --text bar the slot minus 2px wide, 2px top corners; a
 * deload week the same bar hatched (Styrke); a zero week a 2px --axis stub; null = no mark.
 */
function Strip({
  axis,
  label,
  height,
  bars,
  max,
}: {
  readonly axis: XDomain;
  readonly label: string;
  readonly height: number;
  readonly bars: readonly StripBar[];
  readonly max: number;
}) {
  const vMax = niceMax(max);
  const g = AMARKS.bar.gap;
  return (
    <div className="flex flex-col gap-1" aria-hidden="true">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-11 text-text-muted uppercase">{label}</span>
        <span className="font-mono text-11 text-text-muted">{vMax.toLocaleString("da-DK")}</span>
      </div>
      <div className="relative" style={{ height }}>
        <div className="absolute border-t border-dashed border-border" style={{ left: Y_AXIS_WIDTH, right: MARGIN_RIGHT, top: STRIP_TOP }} />
        <div className="absolute h-px" style={{ left: Y_AXIS_WIDTH, right: MARGIN_RIGHT, bottom: 0, background: AMARKS.baseline.color }} />
        {bars.map((w) => {
          if (w.value === null) return null;
          const zero = w.zero || w.value === 0;
          const left = `calc(${xCss(axis, w.x0)} + ${g / 2}px)`;
          const width = `max(1px, calc(${xCss(axis, w.x1)} - ${xCss(axis, w.x0)} - ${g}px))`;
          if (zero)
            return (
              <div key={w.x0} data-mark="zero" className="absolute bottom-0" style={{ left, width, height: AMARKS.stub.height, background: AMARKS.stub.color }} />
            );
          const h = `calc((100% - ${STRIP_TOP}px) * ${w.value / vMax})`;
          return (
            <div
              key={w.x0}
              data-mark={w.deload ? "deload" : "bar"}
              className="absolute bottom-0"
              style={{
                left,
                width,
                height: h,
                borderRadius: `${AMARKS.bar.radius}px ${AMARKS.bar.radius}px 0 0`,
                ...(w.deload
                  ? { backgroundImage: hatchGradient(), border: `${AMARKS.hatch.outline}px solid ${AMARKS.hatch.color}` }
                  : { background: AMARKS.bar.color }),
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

const STRIP = 96;

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
  if (!hydrated) return <Skeleton height="h-[262px]" />;
  const ticks = wide ? axis.ticksWide : axis.ticksNarrow;
  const bars = (active: WeekBar | null, value: (w: WeekBar) => number): StripBar[] =>
    weeks.map((w) => ({ x0: w.x0, x1: w.x1, value: value(w), zero: w.zero, current: w.current, active: w === active }));
  return (
    <WeekGroup
      axis={axis}
      weeks={weeks}
      ticks={ticks}
      readout={(w) => w.readout}
      // Min-height = head + cells (a week's readout); the stacked sizers grow the row to the
      // tallest real readout (a week with "N udeladt fra trends"), so nothing extra is reserved.
      lines={2}
      cells
      overlay={<SeamOverlay axis={axis} bottom={X_AXIS_HEIGHT} />}
      hasData={(w) => !w.zero}
      todayX={axis.hi - 0.5}
    >
      {(active) => (
        <>
          <Strip axis={axis} label="Timer" height={STRIP} bars={bars(active, (w) => w.hours)} max={max.hours} />
          <div className="h-1" />
          <Strip axis={axis} label="TSS" height={STRIP} bars={bars(active, (w) => w.load)} max={max.load} />
        </>
      )}
    </WeekGroup>
  );
}

// --- /analyse/styrke (analyse-styrke.md §5) ------------------------------------------------

type StrengthAxis = XDomain & { readonly ticksNarrow: readonly AxisTick[]; readonly ticksWide: readonly AxisTick[] };
const BRACKET_Y = AMARKS.bracket.y; // the bracket line in the 18px strip; the label above, the 4px end ticks below

/** A 1px horizontal run from x0 to x1 (day numbers) at BRACKET_Y, solid or dashed 2 3 (deload). */
function BracketRun({ axis, x0, x1, dashed }: { readonly axis: XDomain; readonly x0: number; readonly x1: number; readonly dashed: boolean }) {
  const m = AMARKS.bracket;
  return (
    <div
      className="absolute"
      style={{
        left: xCss(axis, x0),
        width: `calc(${xCss(axis, x1)} - ${xCss(axis, x0)})`,
        top: BRACKET_Y,
        height: m.width,
        background: dashed ? undefined : m.color,
        backgroundImage: dashed ? dashGradient("to right", m.color, m.on, m.off) : undefined,
      }}
    />
  );
}

/**
 * Block ruler (reset-analyse-styrke.md §4): a 1px --axis bracket per block in the 18px strip (4px
 * end ticks, the deload part dashed 2 3, `BLOK 11` Geist Mono 11 muted centred above, omitted when
 * it doesn't fit), and a 1.5px --shade-2 rule at a phase change through every panel. aria-hidden.
 */
function BlockOverlay({
  axis,
  blocks,
  phaseRules,
}: {
  readonly axis: XDomain;
  readonly blocks: readonly BlockSpan[];
  readonly phaseRules: readonly number[];
}) {
  const m = AMARKS.bracket;
  const span = (x0: number, x1: number) => ({ left: xCss(axis, x0), width: `calc(${xCss(axis, x1)} - ${xCss(axis, x0)})` });
  return (
    <div aria-hidden="true">
      {blocks.map((b) => {
        const split = b.deloadX0 === null ? b.x1 : Math.min(b.x1, Math.max(b.x0, b.deloadX0));
        return (
          <div key={b.x0} data-mark="bracket">
            {split > b.x0 && <BracketRun axis={axis} x0={b.x0} x1={split} dashed={false} />}
            {split < b.x1 && <BracketRun axis={axis} x0={split} x1={b.x1} dashed />}
            {[b.x0, b.x1].map((x, i) => (
              <div
                key={x}
                className="absolute"
                style={{
                  left: i === 0 ? xCss(axis, x) : `calc(${xCss(axis, x)} - ${m.width}px)`,
                  top: BRACKET_Y,
                  width: m.width,
                  height: m.tick,
                  background: m.color,
                }}
              />
            ))}
            <div className="@container absolute top-0 flex h-[13px] items-start justify-center overflow-hidden" style={span(b.x0, b.x1)}>
              {/* Omitted (not clipped) when the bracket is narrower than the label + 4px each side. */}
              <span className="hidden font-mono text-11 leading-none whitespace-nowrap text-text-muted uppercase @[4.25rem]:inline">{b.label}</span>
            </div>
          </div>
        );
      })}
      {phaseRules.map((x) => (
        <div
          key={x}
          data-mark="phase"
          className="absolute z-[1]"
          style={{ left: `calc(${xCss(axis, x)} - ${AMARKS.phase.width / 2}px)`, width: AMARKS.phase.width, top: 0, bottom: X_AXIS_HEIGHT, background: AMARKS.phase.color }}
        />
      ))}
    </div>
  );
}

const PANEL = 112;
const HEADROOM = 24; // room for the block-best tick and label (r 3.5 + 3 + 6 + 11)

function E1rmPlot({ axis, panel }: { readonly axis: XDomain; readonly panel: E1rmPanel }) {
  const [d0, d1] = panel.domain;
  const f = (v: number) => (v - d0) / (d1 - d0);
  const top = (v: number) => `calc(${HEADROOM}px + (100% - ${HEADROOM}px) * ${1 - f(v)})`;
  const sx = (x: number) => ((x - axis.lo) / (axis.hi - axis.lo)) * 1000;
  const e = AMARKS.e1rm;
  return (
    <div className="relative">
      <span className="absolute top-0 left-0 z-[1] font-mono text-11 text-text-muted uppercase" aria-hidden="true">
        {panel.name}
      </span>
      {panel.empty !== null ? (
        <p className="flex items-center pt-4 font-sans text-13 text-text-muted" style={{ height: PANEL }}>
          {panel.empty}
        </p>
      ) : (
        <div className="relative" style={{ height: PANEL }} aria-hidden="true">
          {panel.ticks.map((t) => (
            <div key={t}>
              <div className="absolute border-t border-dashed border-border" style={{ left: Y_AXIS_WIDTH, right: MARGIN_RIGHT, top: top(t) }} />
              <span className="absolute right-0 -translate-y-1/2 font-mono text-11 leading-none text-text-muted" style={{ top: top(t) }}>
                {t.toLocaleString("da-DK")}
              </span>
            </div>
          ))}
          {panel.sheet.map((s) => (
            <div key={s.x0}>
              <div
                className="absolute -translate-y-1/2"
                style={{
                  left: xCss(axis, s.x0),
                  width: `calc(${xCss(axis, s.x1)} - ${xCss(axis, s.x0)})`,
                  top: top(s.y),
                  height: e.sheet.width,
                  backgroundImage: dashGradient("to right", e.sheet.color, e.sheet.on, e.sheet.off),
                }}
              />
              <span
                className="absolute -translate-x-full bg-card px-0.5 font-mono text-11 leading-none text-text-muted"
                style={{ left: xCss(axis, s.x1), top: `calc(${top(s.y)} - 14px)` }}
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
                stroke={e.line.color}
                strokeWidth={e.line.width}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            ))}
          </svg>
          {panel.points.map((p) => {
            const r = p.logged ? e.logged.r : e.prescribed.r;
            const x = xCss(axis, p.x);
            // Block best: a 1×6 --text tick 3px off the point, its value mono 11 beyond it (below when
            // the point sits under its block's sheet line). No ring.
            const tickTop = p.labelBelow ? `calc(${top(p.y)} + ${r + e.best.gap}px)` : `calc(${top(p.y)} - ${r + e.best.gap + e.best.height}px)`;
            const labelTop = p.labelBelow
              ? `calc(${top(p.y)} + ${r + e.best.gap + e.best.height + 2}px)`
              : `calc(${top(p.y)} - ${r + e.best.gap + e.best.height + 2 + e.best.labelSize}px)`;
            return (
              <div key={p.x}>
                {p.best && (
                  <>
                    <span
                      data-mark="best"
                      className="absolute"
                      style={{ left: `calc(${x} - ${e.best.width / 2}px)`, top: tickTop, width: e.best.width, height: e.best.height, background: e.best.color }}
                    />
                    <span className="absolute -translate-x-1/2 font-mono text-11 leading-none text-text" style={{ left: x, top: labelTop }}>
                      {p.label}
                    </span>
                  </>
                )}
                <span
                  data-mark={p.logged ? "logged" : "prescribed"}
                  className="absolute -translate-1/2 rounded-pill"
                  style={
                    p.logged
                      ? { left: x, top: top(p.y), width: 2 * r, height: 2 * r, background: e.logged.fill }
                      : { left: x, top: top(p.y), width: 2 * r, height: 2 * r, background: e.prescribed.fill, border: `${e.prescribed.stroke}px solid ${e.prescribed.color}` }
                  }
                />
              </div>
            );
          })}
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
      {() => (
        // 24px between panels (12 + a 1px --border rule + 12), so one panel's bottom y label never
        // runs into the next one's top label.
        <div className="flex flex-col">
          {panels.map((p, i) => (
            <div key={p.lift} className={i === 0 ? undefined : "mt-3 border-t border-border pt-3"}>
              <E1rmPlot axis={axis} panel={p} />
            </div>
          ))}
        </div>
      )}
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

const TONNAGE_STRIP = 72;

function TonnageStripsInner({ axis, blocks, phaseRules, weeks, max }: TonnageProps) {
  const hydrated = useHydrated();
  const wide = useWide();
  if (!hydrated) return <Skeleton height="h-[324px]" />;
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
            height={TONNAGE_STRIP}
            max={max[lift]}
            bars={weeks.map((w) => ({
              x0: w.x0,
              x1: w.x1,
              value: w.tonnage[lift],
              zero: w.tonnage[lift] === 0,
              current: w.current,
              active: w === active,
              deload: isDeloadWeek(w, blocks),
            }))}
          />
        ))
      }
    </WeekGroup>
  );
}
