"use client";

import { catchError, type ErrorInfo } from "next/error";
import { type ReactElement, type ReactNode, useCallback, useState, useSyncExternalStore } from "react";
import { Bar, ComposedChart, ReferenceDot, ReferenceLine, Scatter, XAxis, YAxis } from "recharts";

import { bracketLabel, dayTickWidth, isCombDay, MARKS, monoLabelWidth, prognoseEvery } from "@/lib/chart-marks";
import {
  type BlockSpan,
  CHART_WINDOW_DAYS,
  type ChartPoint,
  ctlBandArea,
  type DashboardView,
  strengthUnknownFrom,
} from "@/lib/dashboard-view";
import { dayNumber } from "@/lib/dates";
import { nearestIndex, type Readout, restingReadout, xAtPointer } from "@/lib/chart-readout";
import { formatDate, formatDay, LOCALE, TSS_PER_DAY } from "@/lib/format";
import { prognoseStatus, strengthLine, strengthUnknownNote } from "@/lib/prognose-text";

import {
  type BarShapeProps,
  BlockBracket,
  BracketSwatch,
  dayTickShape,
  hollowDotShape,
  HollowDotSwatch,
  needleShape,
  RingedDot,
  TodayRule,
  TodayTick,
} from "./ChartMarks";
import { ChartReadout, Marker, PLOT_FOCUS, PointerTip, ReadoutSpace, useChartPick } from "./ChartReadout";

import { LineSample, SERIES, type SeriesKey } from "./ChartSeries";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { WarningLine } from "./WarningLine";

/**
 * CTL / ATL / TSB per day, centred on the latest measured day ("i dag"), with the prognose to
 * its right (load.md §9) with the CTL band after the block (§10), as marks (instrument-load.md §3):
 * CTL/ATL a day tick, TSB a needle, the prognose hollow, blocks hairline brackets, today the red tick.
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
  /** Rendered under the plot's x labels, before the notes, whenever the legend is (load.md §8b, §11b). */
  readonly explainer?: ReactNode;
};

const DAY_MS = 86_400_000;
const WINDOW_DAYS = CHART_WINDOW_DAYS;
export const TICK = { fill: "var(--text-muted)", fontSize: 12, fontWeight: 500 } as const;
/** /load's axis numbers: mono 12 muted (spec §3). */
const MONO_TICK = { fill: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)" } as const;
const WEEKDAY_FORMAT = new Intl.DateTimeFormat(LOCALE, { weekday: "long", timeZone: "UTC" });

/** Plot geometry shared by the SVG and the HTML strip/region/rule so they line up exactly. */
const Y_AXIS_WIDTH = 32;
const MARGIN_RIGHT = 16;
const X_AXIS_HEIGHT = 30;
/** Room above the highest mark inside the plot (the brackets sit in the 24px strip above it). */
const PLOT_TOP = 6;
/** The bracket line's y in the 24px strip: label 4px above it, end ticks 6px down. */
const BRACKET_Y = 16.5;
const TODAY_CAPTION = "I dag";
const TODAY_CAPTION_GAP = 4;

/**
 * ctlBand: [ctl_low, ctl_high] as stored, or null; comb: this band day carries a range tick.
 * ctlM/atlM: the measured value (null on prognose days); ctlP/atlP: the prognose value on the
 * days that carry a hollow dot (every 2nd below lg), else null. Values as-is from Python.
 */
type Row = ChartPoint & {
  readonly x: number;
  readonly ctlBand: readonly [number, number] | null;
  readonly comb: boolean;
  readonly ctlM: number | null;
  readonly atlM: number | null;
  readonly ctlP: number | null;
  readonly atlP: number | null;
};

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
      <Legend prognose={hasPrognose} />
      <p className="font-mono text-12 text-text-muted" aria-hidden="true">
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
      {/* "Hvad betyder det?" under the x labels, before the notes (load.md §11b). */}
      {props.explainer}
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

const READOUT_LINES = 3;

function Chart({ points, blocks, lastActual, today: todayDate, title }: ChartProps) {
  const hydrated = useHydrated();
  const wide = useWide();
  const lg = useLg();
  const [measure, size] = useBoxSize();
  const every = prognoseEvery(lg);
  // Day counts from the first prognose / first band day (cadence and comb), by index.
  const firstProjected = points.findIndex((p) => p.kind === "projected");
  const firstBand = points.findIndex((p) => ctlBandArea(p) !== null);
  const rows: Row[] = points.map((p, i) => {
    const projected = p.kind === "projected";
    const dot = projected && (i - firstProjected) % every === 0;
    const band = ctlBandArea(p);
    return {
      ...p,
      x: dayNumber(p.date),
      ctlBand: band,
      comb: band !== null && isCombDay(i - firstBand),
      ctlM: projected ? null : p.ctl,
      atlM: projected ? null : p.atl,
      ctlP: dot ? p.ctl : null,
      atlP: dot ? p.atl : null,
    };
  });
  const xs = rows.map((r) => r.x);
  // Spec §9b/§9e: the rule sits on today; after a missed run the region starts left of it.
  const today = dayNumber(todayDate);
  const dataEnd = dayNumber(lastActual);
  const prognose = rows.some((r) => r.kind === "projected");
  const last = prognose ? today + WINDOW_DAYS : today;
  const lo = today - WINDOW_DAYS - 0.5;
  const hi = last + 0.5;
  const latestIndex = rows.findLastIndex((r) => r.kind === "actual" && r.x <= dataEnd);
  const { pick, plotProps } = useChartPick({
    count: rows.length,
    startIndex: latestIndex,
    indexAt: (clientX, box) =>
      nearestIndex(xs, xAtPointer(clientX, box, { left: Y_AXIS_WIDTH, right: MARGIN_RIGHT }, { lo, hi })),
  });
  if (!hydrated) {
    return (
      <>
        <div className="h-(--chart-height) w-full bg-surface motion-safe:animate-pulse" />
        <ReadoutSpace lines={READOUT_LINES} cells />
      </>
    );
  }

  const byDay = new Map(rows.map((r) => [r.x, r]));
  const todayX = xCss((today - lo) / (hi - lo));
  const step = wide ? 14 : 28;
  const ticks: number[] = [];
  for (let d = -WINDOW_DAYS; d <= WINDOW_DAYS && today + d <= last; d += step) ticks.push(today + d);
  const firstTick = ticks[0];
  const lastTick = ticks[ticks.length - 1];
  const todayRow = byDay.get(today);
  const picked = pick === null ? undefined : rows[pick.index];
  const latest = latestIndex < 0 ? undefined : rows[latestIndex];
  const markerX = picked === undefined ? null : `calc${xCss((picked.x - lo) / (hi - lo))}`;
  const resting = restingReadout(latest === undefined ? null : rowReadout(latest, blocks), "Tryk på grafen for at se en dag");
  const readout = picked !== undefined && pick?.mode !== "mouse" ? rowReadout(picked, blocks) : resting;
  const all = [resting, ...rows.map((r) => rowReadout(r, blocks))];

  // Plot geometry in px from the measured box (the x scale Recharts uses: [y axis, width − right]).
  const plotW = size === null ? 0 : Math.max(0, size.w - Y_AXIS_WIDTH - MARGIN_RIGHT);
  const px = (day: number) => Y_AXIS_WIDTH + (plotW * (day - lo)) / (hi - lo);
  const tickW = dayTickWidth(plotW / (hi - lo));
  const todayPx = px(today);
  const axisY = size === null ? 0 : size.h - X_AXIS_HEIGHT;
  const todayCaptionLeft = todayPx - TODAY_CAPTION_GAP - captionWidth(TODAY_CAPTION);
  const brackets = size === null ? [] : blockBrackets(blocks, { lo, hi, today, dataEnd, px, wide, avoid: todayCaptionLeft });

  return (
    <>
    <div
      {...plotProps}
      aria-label={`${title}. Piletaster vælger en dag`}
      className={`relative flex h-(--chart-height) w-full flex-col ${PLOT_FOCUS}`}
    >
      {/* Measures the plot box and draws the strip's brackets, the today rule and the red today tick. */}
      <div ref={measure} aria-hidden="true" className="pointer-events-none absolute inset-0">
        {size !== null && (
          <svg width={size.w} height={size.h} className="absolute inset-0 overflow-visible">
            {brackets.map((b) => (
              <g key={b.key}>
                <BlockBracket x0={b.x0} x1={b.x1} deloadX0={b.deloadX0} y={BRACKET_Y} />
                {b.label !== null && (
                  <text
                    x={b.labelX}
                    y={BRACKET_Y - MARKS.bracket.label.gap}
                    textAnchor="middle"
                    fill={MARKS.bracket.label.color}
                    fontSize={MARKS.bracket.label.size}
                    className="font-mono"
                  >
                    {b.label}
                  </text>
                )}
              </g>
            ))}
            <TodayRule x={todayPx} y0={0} y1={axisY} />
            <TodayTick x={todayPx} y={axisY} />
          </svg>
        )}
      </div>
      {markerX !== null && <Marker left={markerX} bottom={X_AXIS_HEIGHT} />}
      {picked !== undefined && markerX !== null && pick?.mode === "mouse" && (
        <PointerTip readout={rowReadout(picked, blocks)} left={markerX} rightInset={MARGIN_RIGHT} swatch={seriesSwatch} />
      )}
      <div aria-hidden="true" className="relative min-h-6 shrink-0">
        <span
          className="caption absolute top-0 whitespace-nowrap text-text"
          style={{ right: `calc(100% - ${todayX} + ${TODAY_CAPTION_GAP}px)` }}
        >
          {TODAY_CAPTION}
        </span>
        {prognose && (
          <p
            className="caption text-text"
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
          margin={{ top: PLOT_TOP, right: MARGIN_RIGHT, bottom: 0, left: 0 }}
          title={title}
          accessibilityLayer={false}
        >
          <ReferenceLine y={0} stroke={MARKS.zeroLine.color} strokeWidth={MARKS.zeroLine.width} />
          {/* load.md §10a as a range comb (spec §3): ctl_low → ctl_high as stored, every 4th band day. */}
          {rows.map((r) =>
            r.comb && r.ctlBand !== null ? (
              <ReferenceLine
                key={`comb-${r.x}`}
                segment={[
                  { x: r.x, y: r.ctlBand[0] },
                  { x: r.x, y: r.ctlBand[1] },
                ]}
                stroke={MARKS.rangeComb.color}
                strokeWidth={MARKS.rangeComb.width}
                ifOverflow="extendDomain"
              />
            ) : null,
          )}
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
            tick={MONO_TICK}
            tickLine={false}
            axisLine={false}
          />
          {/* TSB: a 1px needle from 0 per day; the prognose needles dashed (spec §3). */}
          <Bar dataKey="tsb" barSize={MARKS.tsb.width} shape={tsbNeedle} isAnimationActive={false} />
          <Scatter dataKey="atlM" shape={dayTickShape(MARKS.atl.thickness, tickW)} isAnimationActive={false} />
          <Scatter dataKey="ctlM" shape={dayTickShape(MARKS.ctl.thickness, tickW)} isAnimationActive={false} />
          <Scatter dataKey="atlP" shape={hollowDotShape(MARKS.atl.prognose.r, MARKS.atl.color, MARKS.atl.prognose.stroke)} isAnimationActive={false} />
          <Scatter dataKey="ctlP" shape={hollowDotShape(MARKS.ctl.prognose.r, MARKS.ctl.color, MARKS.ctl.prognose.stroke)} isAnimationActive={false} />
          {todayRow !== undefined &&
            todayRow.kind === "actual" &&
            TODAY_SERIES.map((key) => (
              <ReferenceDot
                key={`today-${key}`}
                x={today}
                y={todayRow[key]}
                ifOverflow="visible"
                shape={ringedDot(MARKS.todayValue.r)}
              />
            ))}
          {picked !== undefined &&
            TODAY_SERIES.map((key) => (
              <ReferenceDot
                key={`pick-${key}`}
                x={picked.x}
                y={picked[key]}
                ifOverflow="visible"
                shape={ringedDot(MARKS.todayValue.r + 0.5)}
              />
            ))}
        </ComposedChart>
      </div>
    </div>
    <ChartReadout readout={readout} all={all} lines={READOUT_LINES} cells swatch={seriesSwatch} />
    </>
  );
}

/** CTL and ATL get today's (and the picked day's) filled dot; TSB's needle already ends on its value. */
const TODAY_SERIES = ["ctl", "atl"] as const;

const solidNeedle = needleShape(false);
const dashedNeedle = needleShape(true);

/** One Bar for TSB: the measured needle solid, the prognose needle dashed (decided per row). */
function tsbNeedle(props: BarShapeProps & { readonly payload?: { readonly kind?: string } }): ReactElement {
  return props.payload?.kind === "projected" ? dashedNeedle(props) : solidNeedle(props);
}

/** ReferenceDot's shape: filled ink r 3 with the 2px --bg ring (MARKS.todayValue). */
function ringedDot(r: number) {
  // Recharts types a ReferenceDot shape as returning ReactElement<SVGElement>; a <g> is one.
  return function Dot({ cx, cy }: { readonly cx?: number; readonly cy?: number }): ReactElement<SVGElement> {
    const dot = cx === undefined || cy === undefined || !Number.isFinite(cx) || !Number.isFinite(cy) ? <g /> : <RingedDot cx={cx} cy={cy} r={r} />;
    return dot as ReactElement<SVGElement>;
  };
}

type BracketDraw = {
  readonly key: string;
  readonly x0: number;
  readonly x1: number;
  readonly deloadX0: number | null;
  readonly label: string | null;
  /** The label's centre: the bracket's middle, moved left to clear the "I DAG" caption if needed. */
  readonly labelX: number;
};

type BracketContext = {
  readonly lo: number;
  readonly hi: number;
  readonly today: number;
  readonly dataEnd: number;
  readonly px: (day: number) => number;
  readonly wide: boolean;
  /** Left edge of the "I DAG" caption: a label reaching past it is omitted (never overlapped). */
  readonly avoid: number;
};

/** Spec §3: one bracket per block in the window, start → end (ongoing: → lastActual), clipped to the window and today. */
function blockBrackets(blocks: readonly BlockSpan[], c: BracketContext): BracketDraw[] {
  return blocks.flatMap((b) => {
    const end = b.ongoing ? Math.min(dayNumber(b.end), c.dataEnd) : dayNumber(b.end);
    const d0 = Math.max(dayNumber(b.start) - 0.5, c.lo);
    const d1 = Math.min(end + 0.5, c.today + 0.5, c.hi);
    if (d1 <= d0) return [];
    const x0 = c.px(d0);
    const x1 = c.px(d1);
    const deloadX0 = b.deloadStart === null ? null : c.px(Math.max(dayNumber(b.deloadStart) - 0.5, d0));
    const fitted = bracketLabel(x1 - x0, c.wide ? `Blok ${b.blockNo}` : `B${b.blockNo}`);
    const half = fitted === null ? 0 : monoLabelWidth(fitted) / 2;
    const gap = MARKS.bracket.label.gap;
    const labelX = Math.min((x0 + x1) / 2, c.avoid - gap - half);
    // Still over its own bracket after the shift, else omitted (never clipped, never overlapping).
    const label = fitted !== null && labelX - half >= x0 + gap ? fitted : null;
    return [{ key: `${b.start}-${b.name}`, x0, x1, deloadX0, label, labelX }];
  });
}

/** The caption utility's advance: mono 0.6 em + 0.08 em tracking, at 12px. */
function captionWidth(text: string): number {
  return [...text].length * 12 * 0.68;
}

type Size = { readonly w: number; readonly h: number };

/** The element's content box, kept current by a ResizeObserver (null until first measured). */
function useBoxSize(): readonly [(el: HTMLDivElement | null) => (() => void) | undefined, Size | null] {
  const [size, setSize] = useState<Size | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (el === null) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setSize((s) => (s !== null && s.w === width && s.h === height ? s : { w: width, h: height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [measure, size];
}

const LG_QUERY = "(min-width: 1024px)";

function subscribeLg(onChange: () => void): () => void {
  const query = window.matchMedia(LG_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** true from lg: a prognose dot every day instead of every 2nd (spec §3). */
function useLg(): boolean {
  return useSyncExternalStore(
    subscribeLg,
    () => window.matchMedia(LG_QUERY).matches,
    () => false,
  );
}

function seriesSwatch(key: string) {
  const s = SERIES.find((x) => x.key === key);
  return s === undefined ? null : <LineSample series={s} />;
}

/** load.md readout: date (+ prognose status), Fitness / Træthed / Form, then block or prognose basis. */
function rowReadout(row: Row, blocks: readonly BlockSpan[]): Readout {
  if (row.kind === "projected") {
    const estimate = row.estimate;
    const cycling = estimate === null ? null : cyclingLine(row.date, estimate);
    const spans = SERIES.flatMap((s) => {
      const band = row.bands?.[s.key] ?? null;
      if (band === null) return [];
      const lowText = s.format(band.low);
      const highText = s.format(band.high);
      return lowText === highText ? [] : [`${s.short.toLowerCase()} ${lowText} til ${highText}`];
    });
    return {
      head: `${formatDay(row.date)} · ${prognoseStatus(estimate)}`,
      cells: SERIES.map((s) => ({ key: s.key, label: s.short, value: `≈ ${s.format(row[s.key])}` })),
      facts: [
        ...(cycling === null ? [] : [cycling]),
        ...(estimate?.sessions.map((x) => strengthLine(x)) ?? []),
        ...(spans.length === 0 ? [] : [`Spænd: ${spans.join(", ")}`]),
      ],
    };
  }
  const block = blocks.find((b) => b.start <= row.date && row.date <= b.end);
  const deload = block !== undefined && block.deloadStart !== null && block.deloadStart <= row.date;
  return {
    head: formatDay(row.date),
    cells: SERIES.map((s) => ({ key: s.key satisfies SeriesKey, label: s.short, value: s.format(row[s.key]) })),
    facts: block === undefined ? [] : [`${block.name}${deload ? " · deload" : ""}`],
  };
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

/** Date tick (Inter 12 tabular; mono is too wide for 5 dates at 390): first start-, last end-anchored; today's in --text. */
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
      fill={isToday ? "var(--text)" : "var(--text-muted)"}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {formatTick(value)}
    </text>
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

function Legend({ prognose }: { readonly prognose: boolean }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-14 text-text-muted" aria-label="Forklaring">
      <li className="flex items-center gap-2">
        <BracketSwatch />
        Styrkeblok
      </li>
      <li className="flex items-center gap-2">
        <BracketSwatch deload />
        Deload-uge
      </li>
      {prognose && (
        <li className="flex items-center gap-2">
          <HollowDotSwatch />
          Prognose
        </li>
      )}
    </ul>
  );
}
