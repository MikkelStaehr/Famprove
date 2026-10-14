"use client";

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";

import { MISSING, type Readout } from "@/lib/chart-readout";
import type { IsoDate } from "@/lib/db/rows";
import { formatDate, formatDay, formatLoad } from "@/lib/format";
import { barDays, barTop, beforeLogSpan, type DayCell, type DayLoad, gridWeeks, type ShadeLevel } from "@/lib/load-days";

import { ChartReadout, PLOT_FOCUS, PointerTip, useChartPick } from "./ChartReadout";
import { SegmentedControl } from "./SegmentedControl";

/**
 * Belastning's two day charts (design/specs/reset-belastning.md §4–§5, mockup B): the training-day
 * grid and the daily TSS bars. Values are daily_load's as-is; shade and bar height are drawing scales
 * (lib/load-days.ts). Before the strength log a day without a ride is unknown, never rest.
 */

const SHADE: Readonly<Record<ShadeLevel, string>> = {
  0: "bg-track",
  1: "bg-shade-1",
  2: "bg-shade-2",
  3: "bg-text",
};
const UNKNOWN = "border border-dashed border-shade-1";
const HATCH = "repeating-linear-gradient(135deg, var(--shade-2) 0 1.5px, transparent 1.5px 4px)";

/**
 * The day readout (DESIGN.md "Charts: interaction"): `tirs. 13. okt.` · Cykel · Styrke · I alt; strength `–`
 * before the log, said on line 1 (`… · Styrke ikke registreret`) so the row stays two lines tall.
 */
export function dayReadout(c: DayCell): Readout {
  const v = (n: number | null) => (n === null ? MISSING : formatLoad(n));
  return {
    head: c.beforeLog ? `${formatDay(c.date)} · Styrke ikke registreret` : formatDay(c.date),
    cells: [
      { key: "cycling", label: "Cykel", value: v(c.cycling), sr: c.cycling === null ? "ikke registreret" : undefined },
      { key: "strength", label: "Styrke", value: v(c.strength), sr: c.strength === null ? "ikke registreret" : undefined },
      { key: "total", label: "I alt", value: v(c.total), sr: c.total === null ? "ikke registreret" : undefined },
    ],
    facts: [],
  };
}

type GridProps = {
  readonly days: readonly DayLoad[];
  readonly today: IsoDate;
  readonly logStart: IsoDate | null;
};

const ROW_LABEL: readonly string[] = ["M", "", "O", "", "F", "", "S"];

/** §4: 12 ISO-week columns, rows Mon → Sun, 20px cells; a grid of cells with one keyboard group. */
export function TrainingDaysGrid({ days, today, logStart }: GridProps) {
  const weeks = gridWeeks(days, today, logStart);
  const cells = weeks.flatMap((w) => w.days);
  const drawn = cells.filter((c): c is DayCell => c !== null);
  const anyUnknown = drawn.some((c) => c.unknown);
  const latest = cells.findLastIndex((c) => c !== null);
  // mouse: a hover (tooltip); otherwise a tap, drag or key (readout row).
  const [sel, setSel] = useState<{ readonly i: number; readonly mouse: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // The cell a tap just cleared: the same press dragging over it doesn't select it again.
  const cleared = useRef<number | null>(null);

  useEffect(() => {
    if (sel === null) return;
    const onDown = (e: globalThis.PointerEvent) => {
      if (ref.current !== null && !e.composedPath().includes(ref.current)) setSel(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [sel]);

  if (drawn.every((c) => c.total === null && c.unknown) && days.length === 0) {
    return <p className="text-13 text-text-muted">Ingen dage med data i perioden.</p>;
  }

  const pickAt = (e: PointerEvent<HTMLDivElement>) => {
    const mouse = e.pointerType === "mouse";
    const press = e.type === "pointerdown";
    if (!mouse && !press && e.buttons === 0) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-i]");
    const i = el instanceof HTMLElement ? Number(el.dataset.i) : NaN;
    if (!Number.isInteger(i) || cells[i] === null) return;
    if (!mouse) {
      // Tap the selected day again: the readout goes away.
      if (press && sel?.i === i) {
        cleared.current = i;
        setSel(null);
        return;
      }
      if (!press && cleared.current === i) return;
      cleared.current = null;
    }
    setSel({ i, mouse });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") return setSel(null);
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = sel === null ? latest : sel.i + step;
    if (next >= 0 && next < cells.length && cells[next] !== null) setSel({ i: next, mouse: false });
  };

  const selected = sel === null ? null : (cells[sel.i] ?? null);
  // The readout row only after a tap, drag or key (user 2026-10-14); a mouse hover gets the tooltip.
  const readout = selected === null || sel?.mouse === true ? null : dayReadout(selected);
  const tip = selected !== null && sel?.mouse === true ? { readout: dayReadout(selected), left: `${Math.floor(sel.i / 7) * 24 + 10}px` } : null;
  const first = weeks[0]?.weekStart ?? today;

  return (
    <>
      <p className="sr-only">
        Træningsdage de sidste 12 uger, fra {formatDate(first)} til {formatDate(today)}. Hver dag i tabellen nedenfor.
      </p>
      <div className="flex gap-2.5">
        <div aria-hidden="true" className="grid grid-rows-[repeat(7,20px)] gap-1 font-mono text-11 leading-5 text-text-muted">
          {ROW_LABEL.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
        <div className="min-w-0">
          <div
            ref={ref}
            role="group"
            tabIndex={0}
            aria-label="Træningsdage. Brug piletasterne for at gå dag for dag."
            onPointerDown={pickAt}
            onPointerMove={pickAt}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") setSel((s) => (s?.mouse === true ? null : s));
            }}
            onKeyDown={onKey}
            onBlur={() => setSel(null)}
            className={`relative grid w-max grid-flow-col grid-rows-[repeat(7,20px)] gap-1 rounded-cell ${PLOT_FOCUS}`}
            style={{ touchAction: "pan-y", gridAutoColumns: "20px" }}
          >
            {cells.map((c, i) =>
              c === null ? (
                <span key={i} aria-hidden="true" />
              ) : (
                <span
                  key={c.date}
                  data-i={i}
                  aria-hidden="true"
                  className={`block size-5 rounded-cell ${c.unknown || c.level === null ? UNKNOWN : SHADE[c.level]} ${
                    i === sel?.i
                      ? "outline-[1.5px] outline-offset-1 outline-text outline-solid"
                      : c.date === today
                        ? "outline-[1.5px] outline-offset-1 outline-today outline-solid"
                        : ""
                  }`}
                />
              ),
            )}
            {tip !== null && <PointerTip readout={tip.readout} left={tip.left} rightInset={0} />}
          </div>
          <MonthLabels weeks={weeks.map((w) => w.weekStart)} />
        </div>
      </div>
      <div className="flex flex-col gap-1 font-mono text-11 text-text-muted">
        <p className="flex flex-wrap items-center gap-1.5">
          Hvile
          {([0, 1, 2, 3] as const).map((l) => (
            <span key={l} aria-hidden="true" className={`block size-3 rounded-[3px] ${SHADE[l]}`} />
          ))}
          Hård
          {anyUnknown && (
            <>
              <span aria-hidden="true" className={`ml-3 block size-3 rounded-[3px] ${UNKNOWN}`} />
              Ukendt
            </>
          )}
        </p>
        <p>TSS 0 · 1–49 · 50–99 · 100+</p>
      </div>
      {anyUnknown && logStart !== null && (
        <p className="text-13 text-text-muted">
          Styrke er ikke registreret før {formatDate(logStart)}; dage uden cykling er ukendte.
        </p>
      )}
      <ChartReadout readout={readout} all={drawn.map(dayReadout)} lines={2} cells />
      <DayTable cells={drawn} />
    </>
  );
}

/** Month names under the grid, at the first column whose Monday starts a new month. */
function MonthLabels({ weeks }: { readonly weeks: readonly IsoDate[] }) {
  const fmt = new Intl.DateTimeFormat("da-DK", { month: "short", timeZone: "UTC" });
  return (
    <div aria-hidden="true" className="relative mt-2 h-lh font-mono text-11 text-text-muted">
      {weeks.map((w, i) => {
        const prev = i === 0 ? null : weeks[i - 1];
        const newMonth = prev === null ? Number(w.slice(8, 10)) <= 7 : w.slice(5, 7) !== prev.slice(5, 7);
        if (!newMonth) return null;
        return (
          <span key={w} className="absolute top-0 whitespace-nowrap" style={{ left: i * 24 }}>
            {fmt.format(new Date(`${w}T00:00:00Z`))}
          </span>
        );
      })}
    </div>
  );
}

/** The grid's values as a visually hidden table (level 1 is under 3:1; this and the readout carry the values). */
function DayTable({ cells }: { readonly cells: readonly DayCell[] }) {
  const v = (n: number | null) => (n === null ? "ikke registreret" : formatLoad(n));
  return (
    // The wrapper is sr-only, not the table: a table never shrinks to 1px and would widen the page.
    <div className="sr-only">
    <table>
      <caption>Træningsdage</caption>
      <thead>
        <tr>
          <th scope="col">Dato</th>
          <th scope="col">Cykel</th>
          <th scope="col">Styrke</th>
          <th scope="col">I alt</th>
        </tr>
      </thead>
      <tbody>
        {cells.map((c) => (
          <tr key={c.date}>
            <th scope="row">{formatDay(c.date)}</th>
            <td>{v(c.cycling)}</td>
            <td>{v(c.strength)}</td>
            <td>{v(c.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

type BarsRange = "4U" | "12U";
const BAR_RANGES = [
  { value: "4U", label: "4U", ariaLabel: "4 uger" },
  { value: "12U", label: "12U", ariaLabel: "12 uger" },
] as const;
const PLOT_H = 130;
const STRIP_H = 16;

/** §5: one bar per day, cycling solid at the bottom, strength hatched on top; 4U / 12U. */
export function DailyTssBars({ days, today, logStart, titleId }: GridProps & { readonly titleId: string }) {
  const [range, setRange] = useState<BarsRange>("4U");
  const n = range === "4U" ? 28 : 84;
  const cells = barDays(days, today, n, logStart);
  const top = barTop(cells);
  const before = beforeLogSpan(cells);
  const latest = cells.findLastIndex((c) => c.total !== null);
  const { pick, plotProps } = useChartPick({
    count: n,
    startIndex: Math.max(0, latest),
    indexAt: (clientX, box) => Math.max(0, Math.min(n - 1, Math.floor(((clientX - box.left) / box.width) * n))),
    toggle: true,
  });
  // The readout row only after a tap, drag or key (user 2026-10-14); a mouse hover gets the tooltip.
  const picked = pick === null ? undefined : cells[pick.index];
  const readout = picked === undefined || pick?.mode === "mouse" ? null : dayReadout(picked);
  const empty = cells.every((c) => c.total === null && c.cycling === null);
  const mid = cells[Math.floor(n / 2)]?.date ?? today;
  const h = (v: number) => (Math.max(0, v) / top) * PLOT_H;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id={titleId} className="font-sans text-16 font-medium text-text">
          TSS pr. dag
        </h2>
        <SegmentedControl label="Periode" segments={BAR_RANGES} value={range} onChange={setRange} />
      </div>
      <p className="sr-only">
        Daglig TSS fra {formatDate(cells[0]?.date ?? today)} til i dag, cykel og styrke. Tallene står i tabellen under Træningsdage.
      </p>
      {empty ? (
        <p className="text-13 text-text-muted">Ingen dage med data i perioden.</p>
      ) : (
        <div className="flex flex-col gap-1">
          <div
            {...plotProps}
            aria-label="TSS pr. dag. Brug piletasterne for at gå dag for dag."
            className={`relative rounded-control ${PLOT_FOCUS}`}
            style={{ ...plotProps.style, height: STRIP_H + PLOT_H + 1 }}
          >
            {before !== null && (
              <div
                aria-hidden="true"
                className="absolute top-0 flex flex-col"
                style={{ left: `${(before[0] / n) * 100}%`, width: `${((before[1] - before[0] + 1) / n) * 100}%` }}
              >
                <span className="truncate font-mono text-11 leading-none text-text-muted">styrke ikke registreret</span>
                <span className="mt-0.5 block h-1.5 border-x-[1.5px] border-t-[1.5px] border-dashed border-text-muted" />
              </div>
            )}
            <div aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: STRIP_H }}>
              <span className="absolute right-0 -top-4 font-mono text-11 leading-none text-text-muted">{top}</span>
            </div>
            <div
              aria-hidden="true"
              className={`absolute inset-x-0 flex items-end border-b border-axis ${range === "4U" ? "gap-1" : "gap-px"}`}
              style={{ top: STRIP_H, height: PLOT_H + 1 }}
            >
              {cells.map((c, i) => {
                const cyc = c.cycling ?? 0;
                const str = c.strength ?? 0;
                const total = c.total ?? 0;
                const selected = pick?.index === i;
                return (
                  <div key={c.date} className="relative flex h-full min-w-0 flex-1 flex-col justify-end">
                    {selected && <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-text" />}
                    {c.unknown ? null : Math.round(total) <= 0 ? (
                      <span className="block h-0.5 bg-axis" />
                    ) : (
                      <>
                        {Math.round(str) > 0 && (
                          <span
                            className="block rounded-t-[3px] border border-shade-2"
                            style={{ height: h(str), backgroundImage: HATCH }}
                          />
                        )}
                        {Math.round(cyc) > 0 && (
                          <span className={`block bg-text ${Math.round(str) > 0 ? "" : "rounded-t-[3px]"}`} style={{ height: h(cyc) }} />
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {picked !== undefined && pick?.mode === "mouse" && (
              <PointerTip readout={dayReadout(picked)} left={`${((pick.index + 0.5) / n) * 100}%`} rightInset={0} />
            )}
          </div>
          <div aria-hidden="true" className="relative h-lh font-mono text-11 text-text-muted">
            <span className="absolute left-0">{formatDate(cells[0]?.date ?? today)}</span>
            <span className="absolute left-1/2 -translate-x-1/2">{formatDate(mid)}</span>
            <span className="absolute right-0">i dag</span>
          </div>
        </div>
      )}
      <ul aria-label="Forklaring" className="flex flex-wrap gap-x-4 font-mono text-11 text-text-muted">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="block size-2.5 bg-text" />
          Cykel
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="block size-2.5 border border-shade-2" style={{ backgroundImage: HATCH }} />
          Styrke
        </li>
      </ul>
      <ChartReadout readout={readout} all={cells.map(dayReadout)} lines={2} cells />
    </>
  );
}

