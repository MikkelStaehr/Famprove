import { Suspense } from "react";

import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { KeyFigure, type Delta } from "@/components/KeyFigure";
import { StatusBadge } from "@/components/StatusBadge";
import { TrendChart } from "@/components/TrendChart";
import { WeekDays, WeekDaysSkeleton } from "@/components/WeekDays";
import { LatestWeekLink, weekHref, WeekSwitcher } from "@/components/WeekSwitcher";
import {
  buildDashboardView,
  dayDetails,
  type DashboardView,
  type DayDetail,
  type Freshness,
  type WeekNav,
} from "@/lib/dashboard-view";
import { EnvError } from "@/lib/db/env";
import { PostgrestError } from "@/lib/db/postgrest";
import { loadDashboardData, loadWeekDetail } from "@/lib/db/queries";
import { RowError } from "@/lib/db/rows";
import { formatDay, formatLoad, formatSigned, formatUpdatedAt, TSS_PER_DAY } from "@/lib/format";

type ReadyView = Extract<DashboardView, { kind: "ready" }>;
type DataError = EnvError | PostgrestError | RowError;
type Failed = { readonly kind: "error"; readonly error: DataError; readonly at: Date };
type PageState = DashboardView | Failed;
type WeekState = { readonly kind: "ready"; readonly days: readonly DayDetail[] } | Failed;

const CHART_TITLE = "Fitness, fatigue and form";

function isDataError(error: unknown): error is DataError {
  return error instanceof EnvError || error instanceof PostgrestError || error instanceof RowError;
}

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

export default async function Page({ searchParams }: PageProps<"/">) {
  const { week } = await searchParams;
  const state = await loadPageState(typeof week === "string" ? week : undefined);
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-20 font-bold">Training load</h1>
        {state.kind === "ready" && <UpdatedLine freshness={state.freshness} />}
      </header>
      {state.kind === "error" && <LoadError error={state.error} at={state.at} />}
      {state.kind === "empty" && (
        <EmptyState message="No training load has been computed yet. The daily job fills it at about 05:00." />
      )}
      {state.kind === "ready" && <Dashboard view={state} />}
    </>
  );
}

function Dashboard({ view }: { readonly view: ReadyView }) {
  const { hero, week } = view;
  return (
    <>
      <KeyFigure
        id="form-today"
        label="Form (TSB)"
        context={formatDay(hero.date)}
        value={formatSigned(hero.tsb)}
        unit={TSS_PER_DAY}
        status={
          hero.zone === null ? (
            <StatusBadge tone="neutral" label="Zone not computed" />
          ) : (
            <StatusBadge tone={hero.zone.tone} label={hero.zone.label} />
          )
        }
        delta={fitnessDelta(hero.ctlRamp7d)}
        detail={`Fitness (CTL) ${formatLoad(hero.ctl)} − fatigue (ATL) ${formatLoad(hero.atl)}`}
      />

      <Card id="trend" title={CHART_TITLE}>
        <figure className="flex flex-col gap-2">
          <TrendChart points={view.chart} blocks={view.blocks} title={CHART_TITLE} />
          <figcaption className="sr-only">{chartSummary(view)}</figcaption>
        </figure>
      </Card>

      <Card
        id="week"
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
  if (ramp === null) return { direction: null, text: "Fitness trend needs 7 days of data" };
  const signed = formatSigned(ramp);
  if (signed.startsWith("+")) return { direction: "up", text: `Fitness rising: ${signed} in 7 days` };
  if (signed.startsWith("−")) return { direction: "down", text: `Fitness falling: ${signed} in 7 days` };
  return { direction: "flat", text: "Fitness steady over 7 days" };
}

/** "Updated <time>"; stale or unknown in --warning with an icon and words, never colour alone. */
function UpdatedLine({ freshness }: { readonly freshness: Freshness }) {
  if (freshness.kind === "fresh") {
    return (
      <p className="text-14 text-text-muted">
        Updated <time dateTime={freshness.computedAt}>{formatUpdatedAt(freshness.computedAt)}</time>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 text-14 text-warning">
      <span className="flex h-lh shrink-0 items-center">
        <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3" fill="currentColor">
          <path d="M6 1 11 11H1Z" />
        </svg>
      </span>
      {freshness.kind === "stale" ? (
        <span>
          Stale: last updated{" "}
          <time dateTime={freshness.computedAt}>{formatUpdatedAt(freshness.computedAt)}</time>. The job
          should run daily at about 05:00.
        </span>
      ) : (
        <span>Update time unknown, so the data may be stale.</span>
      )}
    </p>
  );
}

function describeDataError(error: DataError): string {
  if (error instanceof EnvError) return "The server is missing its database settings.";
  if (error instanceof PostgrestError) return `Reading ${error.table} from the database failed.`;
  return "The database returned data in an unexpected shape.";
}

function LoadError({ error, at }: { readonly error: DataError; readonly at: Date }) {
  return (
    <ErrorState
      title="Couldn't load training data"
      what={describeDataError(error)}
      detail={error.message}
      at={{ iso: at.toISOString(), text: formatUpdatedAt(at.toISOString()) }}
      retry={{ href: "/" }}
    />
  );
}

/** Text alternative for the chart: today's values, the 7-day fitness change and the blocks. */
function chartSummary({ hero, chart, blocks }: ReadyView): string {
  const parts = [
    `Daily fitness (CTL), fatigue (ATL) and form (TSB) in ${TSS_PER_DAY} from ${formatDay(chart[0].date)} to ${formatDay(hero.date)}.`,
    `On ${formatDay(hero.date)}: fitness ${formatLoad(hero.ctl)}, fatigue ${formatLoad(hero.atl)}, form ${formatSigned(hero.tsb)}.`,
  ];
  if (hero.ctlRamp7d !== null) {
    parts.push(`Fitness changed by ${formatSigned(hero.ctlRamp7d)} over the last 7 days.`);
  }
  if (blocks.length === 0) parts.push("No strength blocks in this period.");
  for (const b of blocks) {
    const span = b.ongoing
      ? `from ${formatDay(b.start)}, ongoing`
      : `${formatDay(b.start)} to ${formatDay(b.end)}`;
    const deload = b.deloadStart === null ? "" : `, deload week from ${formatDay(b.deloadStart)}`;
    parts.push(`Strength block ${b.blockNo}: ${span}${deload}.`);
  }
  return parts.join(" ");
}
