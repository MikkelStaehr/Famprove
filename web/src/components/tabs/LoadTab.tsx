import { type ReactNode, Suspense } from "react";

import { Card } from "@/components/Card";
import { DailyTssBars, TrainingDaysGrid } from "@/components/DayCharts";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { FitnessCurve } from "@/components/FitnessCurve";
import { FtpLine } from "@/components/FtpLine";
import { LoadExplainer } from "@/components/LoadExplainer";
import { RollingNumber } from "@/components/motion/RollingNumber";
import { MonoCaption } from "@/components/MonoCaption";
import { RefreshProvider, RefreshStatus } from "@/components/Refresh";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Tile } from "@/components/Tile";
import { UpdatedLine, UpdatedTime } from "@/components/UpdatedLine";
import { WarningLine } from "@/components/WarningLine";
import { ZoneBar } from "@/components/ZoneBar";
import { ZonePill } from "@/components/ZonePill";
import { WeekCard } from "@/components/WeekCard";
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
import { loadAppNotices, loadDashboardData, loadExerciseCategories, loadFtpCheck, loadTrainingPlan, loadWeekDetail } from "@/lib/db/queries";
import type { IsoDate } from "@/lib/db/rows";
import { FTP_NOTICE_KIND, ftpLine } from "@/lib/ftp-line";
import { LOAD_GRID, LOAD_PLACE } from "@/lib/load-grid";
import { noticeText } from "@/lib/notices";
import {
  formatDate,
  formatDay,
  formatLoad,
  formatSigned,
  formatUpdatedAt,
  stopAfter,
  TSS_PER_DAY,
} from "@/lib/format";
import { formatOneDecimal, rampText, rampVerdict } from "@/lib/ramp-verdict";
import { isoWeek } from "@/lib/dates";
import {
  COARSE_ZONES_NOTE,
  prognoseSentence,
  STRENGTH_ESTIMATE_NOTE,
  strengthUnknownNote,
  cyclingBasisNote,
} from "@/lib/prognose-text";
import { resolveToday, strengthWeek } from "@/lib/training-view";
import { type DatedPlan, datedPlan } from "@/lib/week-plan";
import { isZoneKey, ZONE_CLASS, zoneReading, zoneSentence } from "@/lib/zone-scale";

type ReadyView = Extract<DashboardView, { kind: "ready" }>;
type Failed = { readonly kind: "error"; readonly error: DataError; readonly at: Date };
type PageState = DashboardView | Failed;
type WeekState = { readonly kind: "ready"; readonly days: readonly DayDetail[] } | Failed;

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

/** Belastning (/load); `week` is the `?week=` search param (the slot page passes it, the default none). */
export async function LoadTab({ week }: { readonly week: string | string[] | undefined }) {
  const [state, notices, ftpCheck] = await Promise.all([
    loadPageState(typeof week === "string" ? week : undefined),
    loadAppNotices(),
    loadFtpCheck(),
  ]);
  // ftp-confirm.md §1: Python's ftp_mismatch notice becomes the FTP line, never a plain notice.
  const ftpNotice =
    ftpCheck.fixtureNotice !== undefined ? ftpCheck.fixtureNotice : (notices.find((n) => n.kind === FTP_NOTICE_KIND) ?? null);
  const ftp = ftpLine(ftpCheck.status, ftpNotice, ftpCheck.latestAck, resolveToday(new Date(), process.env));
  const otherNotices = notices.filter((n) => n.kind !== FTP_NOTICE_KIND);
  return (
    <>
      <RefreshProvider>
      <ScreenHeader
        title="Belastning"
        line={
          state.kind === "ready" && state.freshness.kind === "fresh" ? (
            <UpdatedTime computedAt={state.freshness.computedAt} />
          ) : undefined
        }
        status={<RefreshStatus />}
      >
        {state.kind === "ready" && state.freshness.kind !== "fresh" && (
          <div>
            <UpdatedLine
              freshness={state.freshness}
              staleNote="Jobbet skal køre dagligt omkring kl. 05.00."
              unknownNote="Opdateringstidspunkt ukendt, så data kan være forældet."
            />
            <RefreshStatus />
          </div>
        )}
        {/* ftp-confirm.md §1: the quiet FTP line first under the updated line (fresh or stale), 8px (plain text, refresh R2). */}
        {ftp.kind === "quiet" && <FtpLine line={ftp} />}
        {/* Python's other notices (app_notices): one line each, 8px apart; the FTP warning last, as a disclosure. */}
        {otherNotices.map((n) => (
          <WarningLine key={n.kind}>{noticeText(n.kind, n.message)}</WarningLine>
        ))}
        {ftp.kind === "warning" && <FtpLine line={ftp} />}
      </ScreenHeader>
      </RefreshProvider>
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
        // review-round.md §1: phone order form → tiles → week → curve → grid → bars; from lg a
        // 3-column grid by placement only (DOM order stays).
        <div className={LOAD_GRID}>
          <FormCard view={state} />
          <Tiles view={state} />
          <Week view={state} />
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
          <RollingNumber text={formatSigned(hero.tsb)} />
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

/** fitness-round.md §2: Træthed and this ISO week's total from weekly_load, two equal tiles. */
function Tiles({ view }: { readonly view: ReadyView }) {
  const { hero, thisWeek } = view;
  const weekNo = thisWeek?.isoWeek ?? isoWeek(hero.date).week;
  return (
    <dl className={`grid grid-cols-2 gap-3 ${LOAD_PLACE.tiles}`}>
      <Tile label={<dt>Træthed</dt>} value={<dd><RollingNumber text={formatLoad(hero.atl)} /></dd>} support={<dd>TSS/DAG</dd>} />
      <Tile
        label={<dt>Uge {weekNo}</dt>}
        value={<dd><RollingNumber text={thisWeek === null ? "–" : formatLoad(thisWeek.totalTss)} /></dd>}
        support={<dd>TSS · {thisWeek === null ? "–" : thisWeek.dayCount}/7 d</dd>}
      />
    </dl>
  );
}

/**
 * fitness-round.md §1: the curve card's header. FITNESS caption (the h2), fitness on the last
 * measured day with one decimal, Python's 7-day ramp beside it and the verdict word under it in its
 * zone colour (a plain word, never a pill). Stale data adds the last measured day to the verdict line.
 */
function FitnessHeader({ view }: { readonly view: ReadyView }) {
  const { hero } = view;
  const ramp = rampText(hero.ctlRamp7d);
  const verdict = rampVerdict(hero.ctlRamp7d);
  const stale = view.freshness.kind !== "fresh";
  return (
    <div className="flex flex-col">
      <h2 id="trend" aria-label="Fitness" className="font-mono text-12 font-normal text-text-muted uppercase">
        Fitness
      </h2>
      <p className="sr-only">
        Fitness {formatOneDecimal(hero.ctl)} {TSS_PER_DAY}
        {stale ? ` den ${formatDay(hero.date)}` : ""}. {ramp.sr}
      </p>
      <div aria-hidden="true" className="mt-1 flex flex-wrap items-baseline gap-x-2.5">
        <span className="font-mono text-48 font-medium text-text tabular-nums"><RollingNumber text={formatOneDecimal(hero.ctl)} /></span>
        <span className={`font-mono text-14 font-medium tabular-nums ${hero.ctlRamp7d === null ? "text-text-muted" : "text-text"}`}>{ramp.text}</span>
      </div>
      {verdict !== null && (
        <p className="mt-1.5 font-sans text-13 font-medium">
          <span className={ZONE_CLASS[verdict.zone].text}>{verdict.label}</span>
          {stale && <span className="font-normal text-text-muted"> · seneste {formatDate(hero.date)}</span>}
        </p>
      )}
    </div>
  );
}

function Dashboard({ view }: { readonly view: ReadyView }) {
  const today = resolveToday(new Date(), process.env);
  const cyclingNote = cyclingBasisNote(view.typicalRides, view.calendar, view.allCalendar);
  return (
    <>
      <section aria-labelledby="trend" className={`flex min-w-0 flex-col gap-4.5 rounded-hero border border-border bg-card px-5 pt-5.5 pb-4 ${LOAD_PLACE.curve}`}>
        <FitnessHeader view={view} />
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
        {view.projection === "ready" && cyclingNote !== null && (
          <p className="max-w-[60ch] text-13 text-text-muted">{cyclingNote}</p>
        )}
        {strengthUnknownFrom(view.chart) !== null && (
          <p className="max-w-[60ch] text-13 text-text-muted">{strengthUnknownNote(strengthUnknownFrom(view.chart) ?? view.lastActual)}</p>
        )}
        <LoadExplainer />
      </section>

      <Card id="days" title="Træningsdage" action={<MonoCaption uppercase={false}>12 uger</MonoCaption>} className={LOAD_PLACE.grid}>
        <TrainingDaysGrid days={view.days} today={today} logStart={view.logStart} />
      </Card>

      <section aria-labelledby="bars" className={`flex min-w-0 flex-col gap-3.5 rounded-card border border-border bg-card p-4.5 ${LOAD_PLACE.bars}`}>
        <DailyTssBars titleId="bars" days={view.days} today={today} logStart={view.logStart} />
        <p className="text-13 text-text-muted">{STRENGTH_ESTIMATE_NOTE}</p>
      </section>

    </>
  );
}

/** The week card (review-round.md §1, §7 full): the selected week's days, streamed; the switcher below. */
function Week({ view }: { readonly view: ReadyView }) {
  const { week } = view;
  const today = resolveToday(new Date(), process.env);
  if (week === null) {
    return (
      <WeekCard
        variant="full"
        head={null}
        body={{ kind: "message", node: <EmptyState message="Ingen ugetotal for denne uge endnu." /> }}
        className={LOAD_PLACE.week}
      />
    );
  }
  const head = week.selected;
  const footer = <WeekSwitcher nav={week} latest={week.isLatest ? null : <LatestWeekLink />} />;
  if (week.selected.days.length === 0) {
    return (
      <WeekCard
        variant="full"
        head={head}
        body={{ kind: "message", node: <EmptyState message={`Ingen træningsdage registreret i uge ${week.selected.isoWeek}.`} /> }}
        footer={footer}
        className={LOAD_PLACE.week}
      />
    );
  }
  return (
    // Keyed by week: switching weeks shows this skeleton; the other cards stay put.
    <Suspense
      key={week.param}
      fallback={
        <WeekCard
          variant="full"
          head={head}
          sentence={
            <p className="sr-only" role="status">
              Henter uge {week.selected.isoWeek}…
            </p>
          }
          body={{ kind: "loading", rows: week.selected.days.length }}
          footer={footer}
          className={LOAD_PLACE.week}
        />
      }
    >
      <WeekSessions nav={week} logStart={view.logStart} today={today} footer={footer} />
    </Suspense>
  );
}

/**
 * The current ISO week's strength plan, from the same reads and rule as Træning's Uge card
 * (lib/week-plan.ts). Other weeks have no plan input. A failed read leaves the list without the
 * plan rows (the days still show); anything that is not a data-layer error is rethrown.
 */
async function loadWeekPlan(nav: WeekNav, today: IsoDate): Promise<DatedPlan | null> {
  if (today < nav.selected.weekStart || nav.selected.weekEnd < today) return null;
  try {
    const [data, categories] = await Promise.all([loadTrainingPlan(today), loadExerciseCategories()]);
    const strength = strengthWeek(data, today, categories);
    return datedPlan(strength, today, nav.selected.days.map((d) => d.date));
  } catch (error) {
    if (isDataError(error)) {
      console.error("dashboard: loading the week's plan failed", error);
      return null;
    }
    throw error;
  }
}

/** Streams in under the week's Suspense boundary; a failure stays inside the week card. */
async function WeekSessions({
  nav,
  logStart,
  today,
  footer,
}: {
  readonly nav: WeekNav;
  readonly logStart: IsoDate | null;
  readonly today: IsoDate;
  readonly footer: ReactNode;
}) {
  const [state, plan] = await Promise.all([loadWeekState(nav), loadWeekPlan(nav, today)]);
  if (state.kind === "error") {
    const at = state.at.toISOString();
    return (
      <WeekCard
        variant="full"
        head={nav.selected}
        body={{
          kind: "message",
          node: (
            <ErrorState
              title="Kunne ikke hente ugens træninger"
              what={describeDataError(state.error)}
              detail={state.error.message}
              at={{ iso: at, text: formatUpdatedAt(at) }}
              retry={{ href: weekHref(nav.param) }}
            />
          ),
        }}
        footer={footer}
        className={LOAD_PLACE.week}
      />
    );
  }
  return (
    <WeekCard
      variant="full"
      head={nav.selected}
      body={{ kind: "rows", week: nav.selected, days: state.days, logStart, today, plan }}
      footer={footer}
      className={LOAD_PLACE.week}
    />
  );
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
    `Den ${formatDay(hero.date)}: fitness ${formatOneDecimal(hero.ctl)}, træthed ${formatLoad(hero.atl)}, form ${formatSigned(hero.tsb)}.`,
  ];
  if (end !== undefined) {
    parts.push(
      prognoseSentence(end, strengthUnknownFrom(chart) !== null),
    );
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
