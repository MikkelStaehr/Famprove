import type { Metadata } from "next";
import { Suspense } from "react";

import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { TrendChart } from "@/components/TrendChart";
import { UpdatedLine } from "@/components/UpdatedLine";
import { ZoneBar } from "@/components/ZoneBar";
import { WeekDays, WeekDaysSkeleton } from "@/components/WeekDays";
import { LatestWeekLink, weekHref, WeekSwitcher } from "@/components/WeekSwitcher";
import {
  buildDashboardView,
  dayDetails,
  type DashboardView,
  type DayDetail,
  type WeekNav,
} from "@/lib/dashboard-view";
import { type DataError, describeDataError, isDataError } from "@/lib/data-error";
import { loadDashboardData, loadWeekDetail } from "@/lib/db/queries";
import {
  formatDate,
  formatDay,
  formatLoad,
  formatSigned,
  formatUpdatedAt,
  TSS_PER_DAY,
} from "@/lib/format";
import { resolveToday } from "@/lib/today-view";

export const metadata: Metadata = {
  title: "Belastning",
};

type ReadyView = Extract<DashboardView, { kind: "ready" }>;
type Failed = { readonly kind: "error"; readonly error: DataError; readonly at: Date };
type PageState = DashboardView | Failed;
type WeekState = { readonly kind: "ready"; readonly days: readonly DayDetail[] } | Failed;

const CHART_TITLE = "Fitness, træthed og form";

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
  const state = await loadPageState(typeof week === "string" ? week : undefined);
  return (
    <>
      <header className="flex flex-col">
        <h1 className="font-display text-44 font-extrabold tracking-[-0.01em] break-words hyphens-auto uppercase italic">
          Belast&shy;ning
        </h1>
        {state.kind === "ready" && (
          <div className="mt-1">
            <UpdatedLine
              freshness={state.freshness}
              staleNote="Jobbet skal køre dagligt omkring kl. 05.00."
              unknownNote="Opdateringstidspunkt ukendt, så data kan være forældet."
            />
          </div>
        )}
        {state.kind === "ready" && <Hero view={state} />}
      </header>
      {state.kind === "error" && <LoadError error={state.error} at={state.at} />}
      {state.kind === "empty" && (
        <EmptyState message="Der er ikke beregnet nogen træningsbelastning endnu. Det daglige job udfylder den omkring kl. 05.00." />
      )}
      {state.kind === "ready" && <Dashboard view={state} />}
    </>
  );
}

/** DESIGN.md Part B › Zone bar, hero size, on --bg (no card); then the fitness delta and detail line. */
function Hero({ view }: { readonly view: ReadyView }) {
  const { hero } = view;
  const delta = fitnessDelta(hero.ctlRamp7d);
  return (
    <div className="mt-3">
      <ZoneBar
        header={{ date: hero.date, tsb: hero.tsb, zone: hero.zone, freshness: view.freshness }}
        today={resolveToday(new Date(), process.env)}
        size="hero"
      />
      <p className="mt-3 flex items-center gap-1.5 text-16 font-semibold">
        {delta.direction !== null && <DirectionIcon direction={delta.direction} />}
        {delta.text}
      </p>
      <p className="mt-1 text-14 text-text-muted tabular-nums">
        Fitness (CTL) {formatLoad(hero.ctl)} − træthed (ATL) {formatLoad(hero.atl)}
      </p>
    </div>
  );
}

/** Arrow for the delta; decorative because the text states the direction in words. */
function DirectionIcon({ direction }: { readonly direction: Direction }) {
  const d =
    direction === "up" ? "M8 3v10M4 7l4-4 4 4" : direction === "down" ? "M8 13V3M4 9l4 4 4-4" : "M3 8h10M9 4l4 4-4 4";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

function Dashboard({ view }: { readonly view: ReadyView }) {
  const { week } = view;
  return (
    <>
      <Card id="trend" variant="calm" title={CHART_TITLE}>
        <figure className="flex flex-col gap-2">
          <TrendChart points={view.chart} blocks={view.blocks} title={CHART_TITLE} />
          <figcaption className="sr-only">{chartSummary(view)}</figcaption>
        </figure>
      </Card>

      <Card
        id="week"
        variant="calm"
        title={weekTitle(week)}
        action={week !== null && !week.isLatest ? <LatestWeekLink /> : undefined}
      >
        {week === null ? (
          <EmptyState message="No weekly total for this week yet." />
        ) : (
          <>
            <WeekSwitcher nav={week} />
            {week.selected.days.length === 0 ? (
              <EmptyState message={`No training days recorded in week ${week.selected.isoWeek}.`} />
            ) : (
              // Keyed by week: switching weeks shows this skeleton; hero and chart stay put.
              <Suspense key={week.param} fallback={<WeekFallback nav={week} />}>
                <WeekSessions nav={week} />
              </Suspense>
            )}
          </>
        )}
      </Card>
    </>
  );
}

function weekTitle(week: WeekNav | null): string {
  if (week === null) return "This week";
  const n = week.selected.isoWeek;
  return week.isLatest ? `This week · week ${n}` : `Week ${n}`;
}

function WeekFallback({ nav }: { readonly nav: WeekNav }) {
  return (
    <>
      <p className="sr-only" role="status">
        Loading week {nav.selected.isoWeek}…
      </p>
      <WeekDaysSkeleton rows={nav.selected.days.length} />
    </>
  );
}

/** Streams in under the week's Suspense boundary; a failure stays inside the week card. */
async function WeekSessions({ nav }: { readonly nav: WeekNav }) {
  const state = await loadWeekState(nav);
  if (state.kind === "error") {
    const at = state.at.toISOString();
    return (
      <ErrorState
        title="Couldn't load this week's sessions"
        what={describeDataError(state.error)}
        detail={state.error.message}
        at={{ iso: at, text: formatUpdatedAt(at) }}
        retry={{ href: weekHref(nav.param) }}
      />
    );
  }
  return <WeekDays week={nav.selected} days={state.days} />;
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
  const parts = [
    `Daglig fitness (CTL), træthed (ATL) og form (TSB) i ${TSS_PER_DAY} fra ${formatDay(chart[0].date)} til ${formatDay(hero.date)}.`,
    `Den ${formatDay(hero.date)}: fitness ${formatLoad(hero.ctl)}, træthed ${formatLoad(hero.atl)}, form ${formatSigned(hero.tsb)}.`,
  ];
  if (hero.ctlRamp7d !== null) {
    parts.push(`Fitness ændrede sig med ${formatSigned(hero.ctlRamp7d)} over de sidste 7 dage.`);
  }
  if (blocks.length === 0) parts.push("Ingen styrkeblokke i perioden.");
  for (const b of blocks) {
    const span = b.ongoing
      ? `fra ${formatDate(b.start)}, igangværende`
      : `${formatDate(b.start)} til ${formatDate(b.end)}`;
    const deload = b.deloadStart === null ? "" : `, deload-uge fra ${formatDate(b.deloadStart)}`;
    parts.push(`Styrkeblok ${b.blockNo}: ${span}${deload}.`);
  }
  return parts.join(" ");
}
