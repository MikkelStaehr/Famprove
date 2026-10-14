import type { Metadata } from "next";
import { Suspense } from "react";

import { Card } from "@/components/Card";
import { DailyTssBars, TrainingDaysGrid } from "@/components/DayCharts";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { FitnessCurve } from "@/components/FitnessCurve";
import { Icon } from "@/components/icons";
import { LoadExplainer } from "@/components/LoadExplainer";
import { MonoCaption } from "@/components/MonoCaption";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Tile } from "@/components/Tile";
import { UpdatedLine } from "@/components/UpdatedLine";
import { WarningLine } from "@/components/WarningLine";
import { ZoneBar } from "@/components/ZoneBar";
import { ZonePill } from "@/components/ZonePill";
import { WeekDays, WeekDaysSkeleton } from "@/components/WeekDays";
import { LatestWeekLink, weekHref, WeekSwitcher } from "@/components/WeekSwitcher";
import {
  buildDashboardView,
  dayDetails,
  type DashboardView,
  type DayDetail,
  strengthUnknownFrom,
  type WeekNav,
} from "@/lib/dashboard-view";
import { type DataError, describeDataError, isDataError } from "@/lib/data-error";
import { loadAppNotices, loadDashboardData, loadWeekDetail } from "@/lib/db/queries";
import type { IsoDate } from "@/lib/db/rows";
import { LOAD_GRID, LOAD_PLACE } from "@/lib/load-grid";
import { noticeText } from "@/lib/notices";
import {
  formatDate,
  formatDateRange,
  formatDay,
  formatLoad,
  formatSigned,
  formatUpdatedAt,
  stopAfter,
} from "@/lib/format";
import { isoWeekNumber } from "@/lib/dates";
import {
  COARSE_ZONES_NOTE,
  prognoseSentence,
  STRENGTH_ESTIMATE_NOTE,
  strengthUnknownNote,
  typicalRidesNote,
} from "@/lib/prognose-text";
import { resolveToday } from "@/lib/training-view";
import { isZoneKey, ZONE_CLASS, zoneReading, zoneSentence } from "@/lib/zone-scale";

export const metadata: Metadata = {
  title: "Belastning",
};

type ReadyView = Extract<DashboardView, { kind: "ready" }>;
type Failed = { readonly kind: "error"; readonly error: DataError; readonly at: Date };
type PageState = DashboardView | Failed;
type WeekState = { readonly kind: "ready"; readonly days: readonly DayDetail[] } | Failed;

type Direction = "up" | "down" | "flat";
type Delta = {
  /** null: no trend available yet (text explains why). */
  readonly direction: Direction | null;
  readonly text: string;
};

/**
 * Loads and shapes the data. Only the data layer's own errors become an ErrorState;
 * anything else (including Next's internal control-flow errors) is rethrown.
 * `week` is the raw `?week=` value: buildDashboardView only matches it against weekly_load rows.
 */
async function loadPageState(week: string | undefined): Promise<PageState> {
  try {
    const data = await loadDashboardData();
    return buildDashboardView(data, new Date(), week);
  } catch (error) {
    if (isDataError(error)) {
      console.error("dashboard: loading data failed", error);
      return { kind: "error", error, at: new Date() };
    }
    throw error;
  }
}

/** The selected week's rides and sets; same error policy as loadPageState. */
async function loadWeekState(nav: WeekNav): Promise<WeekState> {
  try {
    const detail = await loadWeekDetail(nav.selected.weekStart, nav.selected.weekEnd);
    return { kind: "ready", days: dayDetails(nav.selected, detail) };
  } catch (error) {
    if (isDataError(error)) {
      console.error("dashboard: loading week detail failed", error);
      return { kind: "error", error, at: new Date() };
    }
    throw error;
  }
}

export default async function Page({ searchParams }: PageProps<"/load">) {
  const { week } = await searchParams;
  const [state, notices] = await Promise.all([
    loadPageState(typeof week === "string" ? week : undefined),
    loadAppNotices(),
  ]);
  return (
    <>
      <ScreenHeader
        title="Belastning"
        line={
          state.kind === "ready" && state.freshness.kind === "fresh" ? (
            <>
              opdateret <time dateTime={state.freshness.computedAt}>{formatUpdatedAt(state.freshness.computedAt)}</time>
            </>
          ) : undefined
        }
      >
        {state.kind === "ready" && state.freshness.kind !== "fresh" && (
          <UpdatedLine
            freshness={state.freshness}
            staleNote="Jobbet skal køre dagligt omkring kl. 05.00."
            unknownNote="Opdateringstidspunkt ukendt, så data kan være forældet."
          />
        )}
        {/* Python's notices (app_notices), e.g. the FTP sanity check: one line each, 8px apart. */}
        {notices.map((n) => (
          <WarningLine key={n.kind}>{noticeText(n.kind, n.message)}</WarningLine>
        ))}
      </ScreenHeader>
      {/* States replace the whole grid: one full-width card, text capped at 60ch. */}
      {state.kind === "error" && (
        <section aria-label="Fejl" className="rounded-card border border-border bg-card p-4.5">
          <div className="max-w-[60ch]">
            <LoadError error={state.error} at={state.at} />
          </div>
        </section>
      )}
      {state.kind === "empty" && (
        <section aria-label="Ingen data" className="rounded-card border border-border bg-card p-4.5">
          <div className="max-w-[60ch]">
            <EmptyState message="Der er ikke beregnet nogen træningsbelastning endnu. Det daglige job udfylder den omkring kl. 05.00." />
          </div>
        </section>
      )}
      {state.kind === "ready" && (
        // reset-belastning.md §2 / §8: phone order form → tiles → curve → grid → bars → week; from lg
        // a 3-column grid by placement only (DOM order stays).
        <div className={LOAD_GRID}>
          <FormCard view={state} />
          <Tiles view={state} />
          <Dashboard view={state} />
        </div>
      )}
    </>
  );
}

/** §2a: FORM I DAG, the zone pill, the TSB figure in its zone colour beside the zone reading, the ZoneBar, the coarse-zones note. */
function FormCard({ view }: { readonly view: ReadyView }) {
  const { hero } = view;
  const zone = hero.zone !== null && isZoneKey(hero.zone.key) ? hero.zone.key : null;
  const today = resolveToday(new Date(), process.env);
  return (
    <section aria-labelledby="form" className={`flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-5 ${LOAD_PLACE.form}`}>
      <p className="sr-only">{zoneSentence(hero.tsb, zone, hero.date !== today ? formatDay(hero.date) : undefined)}</p>
      <div className="flex items-start justify-between gap-3">
        <h2 id="form" className="font-mono text-12 font-normal text-text-muted uppercase">
          Form i dag
        </h2>
        {zone !== null && hero.zone !== null && <ZonePill zone={zone} label={hero.zone.label} />}
      </div>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span aria-hidden="true" className={`font-mono text-56 font-medium tabular-nums ${zone === null ? "text-text" : ZONE_CLASS[zone].text}`}>
          {formatSigned(hero.tsb)}
        </span>
        <p className="min-w-0 font-sans text-15 text-text-muted" style={{ flex: "1 1 12rem" }}>
          {zoneReading(zone)}
        </p>
      </div>
      <ZoneBar tsb={hero.tsb} zone={zone} />
      {zone === null && <p className="text-13 text-text-muted">Zone ikke beregnet.</p>}
      <p className="text-13 text-text-muted">{COARSE_ZONES_NOTE}</p>
    </section>
  );
}

/** §2b: Fitness (ramp from Python), Træthed, this ISO week's total from weekly_load. */
function Tiles({ view }: { readonly view: ReadyView }) {
  const { hero, thisWeek } = view;
  const delta = fitnessDelta(hero.ctlRamp7d);
  const ramp = hero.ctlRamp7d === null ? null : formatSigned(hero.ctlRamp7d).replace("+", "");
  const weekNo = thisWeek?.isoWeek ?? isoWeekNumber(hero.date);
  return (
    <dl className={`grid grid-cols-3 gap-3 ${LOAD_PLACE.tiles}`}>
      <Tile
        label={<dt>Fitness</dt>}
        value={<dd>{formatLoad(hero.ctl)}</dd>}
        supportTone={ramp === null ? "muted" : "text"}
        support={
          <dd className="flex items-center gap-1">
            {delta.direction !== null && <Icon name={delta.direction === "up" ? "arrow-up" : delta.direction === "down" ? "arrow-down" : "arrow-flat"} size={16} className="size-3" />}
            <span aria-hidden="true">{ramp ?? "–"} / 7 d</span>
            <span className="sr-only">{delta.text}</span>
          </dd>
        }
      />
      <Tile label={<dt>Træthed</dt>} value={<dd>{formatLoad(hero.atl)}</dd>} support={<dd>TSS/DAG</dd>} />
      <Tile
        label={<dt>Uge {weekNo}</dt>}
        value={<dd>{thisWeek === null ? "–" : formatLoad(thisWeek.totalTss)}</dd>}
        support={<dd>TSS · {thisWeek === null ? "–" : thisWeek.dayCount}/7 d</dd>}
      />
    </dl>
  );
}

function Dashboard({ view }: { readonly view: ReadyView }) {
  const { week } = view;
  const today = resolveToday(new Date(), process.env);
  return (
    <>
      <Card
        id="trend"
        title="Fitness"
        shape="hero"
        action={<MonoCaption>TSS/dag</MonoCaption>}
        className={`gap-4.5 ${LOAD_PLACE.curve}`}
      >
        {view.chart.filter((p) => p.kind === "actual").length < 2 ? (
          <EmptyState message="Trenden vises, når der er mindst to dages træningsbelastning." />
        ) : (
          <FitnessCurve points={view.chart} blocks={view.blocks} today={today} lastActual={view.lastActual} summary={chartSummary(view)} />
        )}
        {view.projection === "error" && (
          <WarningLine>Prognosen kunne ikke hentes, så grafen viser kun målte dage. Genindlæs siden for at prøve igen.</WarningLine>
        )}
        {view.projection === "none" && (
          <p className="text-13 text-text-muted">Ingen prognose endnu. Den beregnes af det daglige job omkring kl. 05.00.</p>
        )}
        {view.projection === "ready" && view.typicalRides !== null && (
          <p className="max-w-[60ch] text-13 text-text-muted">{typicalRidesNote(view.typicalRides)}</p>
        )}
        {strengthUnknownFrom(view.chart) !== null && (
          <p className="max-w-[60ch] text-13 text-text-muted">{strengthUnknownNote(strengthUnknownFrom(view.chart) ?? view.lastActual)}</p>
        )}
        <LoadExplainer />
      </Card>

      <Card id="days" title="Træningsdage" action={<MonoCaption uppercase={false}>12 uger</MonoCaption>} className={LOAD_PLACE.grid}>
        <TrainingDaysGrid days={view.days} today={today} logStart={view.logStart} />
      </Card>

      <section aria-labelledby="bars" className={`flex min-w-0 flex-col gap-3.5 rounded-card border border-border bg-card p-4.5 ${LOAD_PLACE.bars}`}>
        <DailyTssBars titleId="bars" days={view.days} today={today} logStart={view.logStart} />
        <p className="text-13 text-text-muted">{STRENGTH_ESTIMATE_NOTE}</p>
      </section>

      <Card
        id="week"
        title={week === null ? "Denne uge" : `Uge ${week.selected.isoWeek}`}
        action={week === null ? undefined : <MonoCaption uppercase={false}>{formatDateRange(week.selected.weekStart, week.selected.weekEnd)}</MonoCaption>}
        className={`gap-1 ${LOAD_PLACE.week}`}
      >
        {week === null ? (
          <EmptyState message="Ingen ugetotal for denne uge endnu." />
        ) : (
          <>
            {week.selected.days.length === 0 ? (
              <EmptyState message={`Ingen træningsdage registreret i uge ${week.selected.isoWeek}.`} />
            ) : (
              // Keyed by week: switching weeks shows this skeleton; the other cards stay put.
              <Suspense key={week.param} fallback={<WeekFallback nav={week} />}>
                <WeekSessions nav={week} logStart={view.logStart} today={today} />
              </Suspense>
            )}
            <div className="mt-3">
              <WeekSwitcher nav={week} latest={week.isLatest ? null : <LatestWeekLink />} />
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function WeekFallback({ nav }: { readonly nav: WeekNav }) {
  return (
    <>
      <p className="sr-only" role="status">
        Henter uge {nav.selected.isoWeek}…
      </p>
      <WeekDaysSkeleton rows={nav.selected.days.length} />
    </>
  );
}

/** Streams in under the week's Suspense boundary; a failure stays inside the week card. */
async function WeekSessions({ nav, logStart, today }: { readonly nav: WeekNav; readonly logStart: IsoDate | null; readonly today: IsoDate }) {
  const state = await loadWeekState(nav);
  if (state.kind === "error") {
    const at = state.at.toISOString();
    return (
      <ErrorState
        title="Kunne ikke hente ugens træninger"
        what={describeDataError(state.error)}
        detail={state.error.message}
        at={{ iso: at, text: formatUpdatedAt(at) }}
        retry={{ href: weekHref(nav.param) }}
      />
    );
  }
  return <WeekDays week={nav.selected} days={state.days} logStart={logStart} today={today} />;
}

/** CTL ramp as "is fitness going up?". Direction follows the displayed (rounded) value. */
function fitnessDelta(ramp: number | null): Delta {
  if (ramp === null) return { direction: null, text: "Fitness-trenden kræver 7 dages data" };
  const signed = formatSigned(ramp);
  if (signed.startsWith("+")) return { direction: "up", text: `Fitness stiger: ${signed} på 7 dage` };
  if (signed.startsWith("−")) return { direction: "down", text: `Fitness falder: ${signed} på 7 dage` };
  return { direction: "flat", text: "Fitness uændret over 7 dage" };
}

function LoadError({ error, at }: { readonly error: DataError; readonly at: Date }) {
  return (
    <ErrorState
      title="Kunne ikke hente træningsdata"
      what={describeDataError(error)}
      detail={error.message}
      at={{ iso: at.toISOString(), text: formatUpdatedAt(at.toISOString()) }}
      retry={{ href: "/load" }}
    />
  );
}

/** Text alternative for the chart: today's values, the 7-day fitness change and the blocks. */
function chartSummary({ hero, chart, blocks }: ReadyView): string {
  const end = chart.findLast((p) => p.kind === "projected");
  const parts = [
    `Den ${formatDay(hero.date)}: fitness ${formatLoad(hero.ctl)}, træthed ${formatLoad(hero.atl)}, form ${formatSigned(hero.tsb)}.`,
  ];
  if (end !== undefined) {
    parts.push(
      prognoseSentence(end, strengthUnknownFrom(chart) !== null),
    );
  }
  if (hero.ctlRamp7d !== null) {
    parts.push(`Fitness ændrede sig med ${formatSigned(hero.ctlRamp7d)} over de sidste 7 dage.`);
  }
  if (blocks.length === 0) parts.push("Ingen styrkeblokke i perioden.");
  for (const b of blocks) {
    const span = b.ongoing
      ? `fra ${formatDate(b.start)}, igangværende`
      : `${formatDate(b.start)} til ${formatDate(b.end)}`;
    const deload = b.deloadStart === null ? "" : `, deload-uge fra ${formatDate(b.deloadStart)}`;
    parts.push(`Styrkeblok ${b.blockNo}: ${span}${deload}`);
  }
  return parts.map((p) => `${p}${stopAfter(p)}`).join(" ");
}
