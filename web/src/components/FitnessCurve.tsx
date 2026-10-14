"use client";

import { type ReactNode, useState } from "react";

import { bracketGeometry, monoLabelWidth } from "@/lib/chart-marks";
import { MISSING, nearestIndex, type Readout, restingReadout } from "@/lib/chart-readout";
import { type BlockSpan, type ChartPoint, ctlBandArea } from "@/lib/dashboard-view";
import { addDays, dayNumber } from "@/lib/dates";
import type { IsoDate } from "@/lib/db/rows";
import { formatDate, formatDay, formatLoad, formatSigned, LOCALE } from "@/lib/format";
import { type CurveRange, curveScale, curveWindow } from "@/lib/load-days";
import { prognoseStatus, strengthLine } from "@/lib/prognose-text";

import { useMedia, useWidth } from "./chart-hooks";
import { ChartReadout, PLOT_FOCUS, PointerTip, ReadoutSpace, useChartPick } from "./ChartReadout";
import { SegmentedControl } from "./SegmentedControl";

/**
 * Belastning's fitness curve (design/specs/reset-belastning.md §3, mockup C): CTL only, measured as a
 * 2px --text line, the prognose 1.5px --text-muted dashed 3 4, the band after the block as a 12 %
 * area, three dashed gridlines, block brackets in a 16px strip, today the 1.5px --today line with
 * `I DAG`. Python's values as-is; the only arithmetic here is the drawing scale (date -> x, value -> y).
 */
type FitnessCurveProps = {
  readonly points: readonly ChartPoint[];
  readonly blocks: readonly BlockSpan[];
  readonly today: IsoDate;
  readonly lastActual: IsoDate;
  /** The sr sentences after the range sentence (today's values, prognose, blocks). */
  readonly summary: string;
};

const STRIP = 16;
const PAD_L = 2;
const PAD_R = 6;
const READOUT_LINES = 4;
const RANGES = [
  { value: "4U", label: "4U", ariaLabel: "4 uger" },
  { value: "12U", label: "12U", ariaLabel: "12 uger" },
  { value: "season", label: "Sæson" },
] as const;
const WEEKDAY_FORMAT = new Intl.DateTimeFormat(LOCALE, { weekday: "long", timeZone: "UTC" });

export function FitnessCurve({ points, blocks, today, lastActual, summary }: FitnessCurveProps) {
  const [range, setRange] = useState<CurveRange>("12U");
  const seriesStart = points[0]?.date ?? today;
  const win = curveWindow(range, today, seriesStart);
  const shown = points.filter((p) => p.date >= win.from && p.date <= win.to);
  const band = shown.some((p) => ctlBandArea(p) !== null);
  const blockInView = blocks.some((b) => b.start <= win.to && b.end >= win.from);
  const end = shown.findLast((p) => p.kind === "projected");
  const rangeSentence = `Fitness (CTL) i TSS/dag fra ${formatDay(win.from)} til ${formatDay(lastActual)}${
    end === undefined ? "" : `, og en anslået prognose til ${formatDay(end.date)}`
  }.`;
  return (
    <>
      <Plot points={shown} blocks={blocks} today={today} lastActual={lastActual} from={win.from} to={win.to} range={range} />
      <p className="sr-only" aria-live="polite">
        {rangeSentence} {summary}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <SegmentedControl label="Periode" segments={RANGES} value={range} onChange={setRange} size="hero" />
        <ul aria-label="Forklaring" className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-11 text-text-muted">
          {end !== undefined && <li>- - - prognose</li>}
          {band && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="block size-2.5 bg-text-muted/12" />
              spænd
            </li>
          )}
          {blockInView && (
            <li className="flex items-center gap-1.5">
              <svg aria-hidden="true" viewBox="0 0 14 8" className="h-2 w-3.5" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                <path d="M0.75 8V1.5h12.5V8" />
              </svg>
              Blok
            </li>
          )}
        </ul>
      </div>
    </>
  );
}

type PlotProps = {
  readonly points: readonly ChartPoint[];
  readonly blocks: readonly BlockSpan[];
  readonly today: IsoDate;
  readonly lastActual: IsoDate;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly range: CurveRange;
};

function Plot({ points, blocks, today, lastActual, from, to, range }: PlotProps) {
  const sm = useMedia("(min-width: 640px)");
  const lg = useMedia("(min-width: 1024px)");
  const [measure, width] = useWidth();
  const plotH = lg ? 280 : sm ? 200 : 180;
  const height = STRIP + plotH;

  const d0 = dayNumber(from);
  const d1 = dayNumber(to);
  const w = width ?? 0;
  const x = (date: IsoDate) => PAD_L + ((dayNumber(date) - d0) / Math.max(1, d1 - d0)) * (w - PAD_L - PAD_R);
  const values = points.flatMap((p) => {
    const b = ctlBandArea(p);
    return b === null ? [p.ctl] : [p.ctl, b[0], b[1]];
  });
  const scale = curveScale(values.length === 0 ? 0 : Math.min(...values), values.length === 0 ? 10 : Math.max(...values));
  const y = (v: number) => STRIP + ((scale.hi - v) / (scale.hi - scale.lo)) * plotH;

  const xs = points.map((p) => x(p.date));
  const latestIndex = points.findLastIndex((p) => p.kind === "actual");
  const { pick, plotProps } = useChartPick({
    count: points.length,
    startIndex: Math.max(0, latestIndex),
    indexAt: (clientX, box) => (points.length === 0 ? null : nearestIndex(xs, clientX - box.left)),
  });

  const readouts = points.map((p) => rowReadout(p, blocks));
  const resting = restingReadout(latestIndex === -1 ? null : readouts[latestIndex], "Tryk på grafen for at se en dag");
  const picked = pick === null ? undefined : points[pick.index];
  const readout = picked !== undefined && pick?.mode !== "mouse" ? readouts[pick?.index ?? 0] : resting;

  const measured = points.filter((p) => p.kind === "actual");
  const projected = points.filter((p) => p.kind === "projected");
  const last = measured.at(-1);
  const line = (ps: readonly ChartPoint[]) => ps.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date).toFixed(1)} ${y(p.ctl).toFixed(1)}`).join("");
  const prognose = last === undefined ? projected : [last, ...projected];
  const bandPts = projected.filter((p) => ctlBandArea(p) !== null);
  const bandPath =
    bandPts.length < 2
      ? null
      : `${bandPts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date).toFixed(1)} ${y(ctlBandArea(p)?.[1] ?? p.ctl).toFixed(1)}`).join("")}${bandPts
          .toReversed()
          .map((p) => `L${x(p.date).toFixed(1)} ${y(ctlBandArea(p)?.[0] ?? p.ctl).toFixed(1)}`)
          .join("")}Z`;
  const todayIn = today >= from && today <= to;
  const tx = x(today);

  return (
    <div ref={measure} className="flex flex-col gap-2">
      <div
        {...plotProps}
        aria-label="Fitness pr. dag. Brug piletasterne for at gå dag for dag."
        className={`relative w-full rounded-control ${PLOT_FOCUS}`}
        style={{ ...plotProps.style, height }}
      >
        {width !== null && (
          <svg key={range} aria-hidden="true" width={w} height={height} className="block overflow-visible motion-safe:animate-[fade-in_150ms_ease-out]">
            {scale.lines.map((v) => (
              <g key={v}>
                <line x1={0} x2={w} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} strokeDasharray="2 4" />
                <text x={w} y={y(v) - 4} textAnchor="end" fontSize={11} fontFamily="var(--font-mono)" fill="var(--text-muted)">
                  {v}
                </text>
              </g>
            ))}
            <line x1={0} x2={w} y1={STRIP + plotH - 0.5} y2={STRIP + plotH - 0.5} stroke="var(--axis)" strokeWidth={1} />
            {blocks.map((b) => (
              <Bracket key={b.name} block={b} x={x} from={from} to={to} />
            ))}
            {bandPath !== null && <path d={bandPath} fill="var(--text-muted)" fillOpacity={0.12} stroke="none" />}
            {prognose.length > 1 && (
              <path d={line(prognose)} fill="none" stroke="var(--text-muted)" strokeWidth={1.5} strokeDasharray="3 4" />
            )}
            {measured.length > 1 && <path d={line(measured)} fill="none" stroke="var(--text)" strokeWidth={2} strokeLinejoin="round" />}
            {todayIn && (
              <g>
                <line x1={tx} x2={tx} y1={STRIP} y2={STRIP + plotH} stroke="var(--today)" strokeWidth={1.5} />
                <text x={tx - 4} y={STRIP + plotH - 4} textAnchor="end" fontSize={11} fontFamily="var(--font-mono)" fill="var(--today)">
                  I DAG
                </text>
              </g>
            )}
            {picked !== undefined && (
              <line x1={x(picked.date)} x2={x(picked.date)} y1={STRIP} y2={STRIP + plotH} stroke="var(--text)" strokeWidth={1} />
            )}
            {last !== undefined && last.date === lastActual && (
              <circle cx={x(last.date)} cy={y(last.ctl)} r={5} fill="var(--bg)" stroke="var(--text)" strokeWidth={2} />
            )}
            {picked !== undefined && (
              <circle cx={x(picked.date)} cy={y(picked.ctl)} r={3.5} fill="var(--text)" stroke="var(--card)" strokeWidth={2} />
            )}
          </svg>
        )}
        {picked !== undefined && pick?.mode === "mouse" && (
          <PointerTip readout={readouts[pick.index]} left={`${x(picked.date)}px`} rightInset={PAD_R} swatch={swatch} />
        )}
      </div>
      <XLabels from={from} to={to} x={x} width={w} wide={sm} />
      {width === null ? (
        <ReadoutSpace lines={READOUT_LINES} cells />
      ) : (
        <ChartReadout readout={readout} all={[resting, ...readouts]} lines={READOUT_LINES} cells swatch={swatch} />
      )}
    </div>
  );
}

/** The Fitness cell's swatch: the 2px line. Træthed and Form have no mark on the curve. */
function swatch(key: string): ReactNode {
  return key === "ctl" ? <span aria-hidden="true" className="block h-0.5 w-3 bg-text" /> : null;
}

function Bracket({ block, x, from, to }: { readonly block: BlockSpan; readonly x: (d: IsoDate) => number; readonly from: IsoDate; readonly to: IsoDate }) {
  if (block.end < from || block.start > to) return null;
  const s = block.start < from ? from : block.start;
  const e = block.end > to ? to : block.end;
  const g = bracketGeometry(x(s), x(e), block.deloadStart === null ? null : x(block.deloadStart));
  if (g.width < 12) return null;
  const long = `Blok ${block.blockNo}`;
  const label = monoLabelWidth(long, 11) + 8 <= g.width ? long : monoLabelWidth(`B${block.blockNo}`, 11) + 8 <= g.width ? `B${block.blockNo}` : null;
  const by = 11.25;
  return (
    <g stroke="var(--text-muted)" strokeWidth={1.5} fill="none">
      {g.solid !== null && <line x1={g.solid.x0} x2={g.solid.x1} y1={by} y2={by} />}
      {g.deload !== null && <line x1={g.deload.x0} x2={g.deload.x1} y1={by} y2={by} strokeDasharray="3 3" />}
      {g.ticks.map((t) => (
        <line key={t} x1={t} x2={t} y1={by} y2={by + 6} />
      ))}
      {label !== null && (
        <text x={g.mid} y={by - 3} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fill="var(--text-muted)" stroke="none">
          {label}
        </text>
      )}
    </g>
  );
}

/** Window start, the month starts that fit, window end: mono 11 muted, 4px under the plot. */
function XLabels({ from, to, x, width, wide }: { readonly from: IsoDate; readonly to: IsoDate; readonly x: (d: IsoDate) => number; readonly width: number; readonly wide: boolean }) {
  const gap = wide ? 72 : 64;
  const months: IsoDate[] = [];
  for (let d = `${from.slice(0, 7)}-01`; d <= to; d = addDays(`${d.slice(0, 7)}-28`, 4).slice(0, 7) + "-01") {
    if (d > from) months.push(d);
  }
  const kept: { date: IsoDate; anchor: "start" | "middle" | "end" }[] = [{ date: from, anchor: "start" }];
  let prev = x(from);
  for (const m of months) {
    const mx = x(m);
    if (mx - prev >= gap && x(to) - mx >= gap) {
      kept.push({ date: m, anchor: "middle" });
      prev = mx;
    }
  }
  kept.push({ date: to, anchor: "end" });
  return (
    <div aria-hidden="true" className="relative mt-0.5 h-lh font-mono text-11 text-text-muted tabular-nums">
      {width > 0 &&
        kept.map((k) => (
          <span
            key={k.date}
            className={`absolute top-0 whitespace-nowrap ${k.anchor === "middle" ? "-translate-x-1/2" : k.anchor === "end" ? "-translate-x-full" : ""}`}
            style={{ left: k.anchor === "end" ? width : k.anchor === "start" ? 0 : x(k.date) }}
          >
            {formatDate(k.date)}
          </span>
        ))}
    </div>
  );
}

/** DESIGN.md readout for the curve: date (+ prognose status), Fitness · Træthed · Form, then block or prognose basis. */
function rowReadout(p: ChartPoint, blocks: readonly BlockSpan[]): Readout {
  if (p.kind === "projected") {
    const e = p.estimate;
    const cycling = e === null ? null : cyclingLine(p.date, e);
    const spans: string[] = [];
    const b = p.bands;
    if (b?.ctl != null && formatLoad(b.ctl.low) !== formatLoad(b.ctl.high)) spans.push(`fitness ${formatLoad(b.ctl.low)} til ${formatLoad(b.ctl.high)}`);
    if (b?.atl != null && formatLoad(b.atl.low) !== formatLoad(b.atl.high)) spans.push(`træthed ${formatLoad(b.atl.low)} til ${formatLoad(b.atl.high)}`);
    if (b?.tsb != null && formatSigned(b.tsb.low) !== formatSigned(b.tsb.high)) spans.push(`form ${formatSigned(b.tsb.low)} til ${formatSigned(b.tsb.high)}`);
    return {
      head: `${formatDay(p.date)} · ${prognoseStatus(e)}`,
      cells: [
        { key: "ctl", label: "Fitness", value: `≈ ${formatLoad(p.ctl)}` },
        { key: "atl", label: "Træthed", value: `≈ ${formatLoad(p.atl)}` },
        { key: "tsb", label: "Form", value: `≈ ${formatSigned(p.tsb)}` },
      ],
      facts: [...(cycling === null ? [] : [cycling]), ...(e?.sessions.map((s) => strengthLine(s)) ?? []), ...(spans.length === 0 ? [] : [`Spænd: ${spans.join(", ")}`])],
    };
  }
  const block = blocks.find((b) => b.start <= p.date && p.date <= b.end);
  const deload = block !== undefined && block.deloadStart !== null && block.deloadStart <= p.date;
  return {
    head: formatDay(p.date),
    cells: [
      { key: "ctl", label: "Fitness", value: Number.isFinite(p.ctl) ? formatLoad(p.ctl) : MISSING },
      { key: "atl", label: "Træthed", value: formatLoad(p.atl) },
      { key: "tsb", label: "Form", value: formatSigned(p.tsb) },
    ],
    facts: block === undefined ? [] : [`${block.name}${deload ? " · deload" : ""}`],
  };
}

function cyclingLine(date: IsoDate, e: NonNullable<ChartPoint["estimate"]>): string | null {
  if (e.cyclingSource === "planned") return `Cykel ${Math.round(e.cyclingTss)} TSS · planlagt tur`;
  const unread = e.rides.some((r) => r.tss === null) ? " (planlagt tur kunne ikke læses)" : "";
  if (e.cyclingTss <= 0 && unread === "") return null;
  return `Cykel ≈ ${Math.round(e.cyclingTss)} TSS · typisk ${WEEKDAY_FORMAT.format(new Date(`${date}T00:00:00Z`))}${unread}`;
}

