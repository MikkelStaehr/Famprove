import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { KeyFigure, type Delta } from "@/components/KeyFigure";
import { StatusBadge } from "@/components/StatusBadge";
import { TrendChart } from "@/components/TrendChart";
import { WeekTable } from "@/components/WeekTable";
import { buildDashboardView, type DashboardView, type Freshness } from "@/lib/dashboard-view";
import { EnvError } from "@/lib/db/env";
import { PostgrestError } from "@/lib/db/postgrest";
import { loadDashboardData } from "@/lib/db/queries";
import { RowError } from "@/lib/db/rows";
import { formatDay, formatLoad, formatSigned, formatUpdatedAt, TSS_PER_DAY } from "@/lib/format";

type ReadyView = Extract<DashboardView, { kind: "ready" }>;
type DataError = EnvError | PostgrestError | RowError;
type PageState = DashboardView | { readonly kind: "error"; readonly error: DataError; readonly at: Date };

const CHART_TITLE = "Fitness, fatigue and form";

/**
 * Loads and shapes the data. Only the data layer's own errors become an ErrorState;
 * anything else (including Next's internal control-flow errors) is rethrown.
 */
async function loadPageState(): Promise<PageState> {
  try {
    const data = await loadDashboardData();
    return buildDashboardView(data, new Date());
  } catch (error) {
    if (error instanceof EnvError || error instanceof PostgrestError || error instanceof RowError) {
      console.error("dashboard: loading data failed", error);
      return { kind: "error", error, at: new Date() };
    }
    throw error;
  }
}

export default async function Page() {
  const state = await loadPageState();
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

      <Card id="week" title={week === null ? "This week" : `This week · week ${week.isoWeek}`}>
        {week === null ? (
          <EmptyState message="No weekly total for this week yet." />
        ) : (
          <WeekTable week={week} />
        )}
      </Card>
    </>
  );
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

function LoadError({ error, at }: { readonly error: DataError; readonly at: Date }) {
  const what =
    error instanceof EnvError
      ? "The server is missing its database settings."
      : error instanceof PostgrestError
        ? `Reading ${error.table} from the database failed.`
        : "The database returned data in an unexpected shape.";
  return (
    <ErrorState
      title="Couldn't load training data"
      what={what}
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
