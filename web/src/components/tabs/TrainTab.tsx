import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";

import { ErrorState } from "@/components/ErrorState";
import { FormCard } from "@/components/FormCard";
import { RideCard } from "@/components/RideCard";
import { SessionBlock, SessionWeekSentence } from "@/components/SessionBlock";
import { SetLogProvider } from "@/components/SetLogProvider";
import { StrengthCard } from "@/components/StrengthCard";
import { RestToday, RideToday } from "@/components/TodayCard";
import { ClipLibrary } from "@/components/ClipLibrary";
import { RefreshProvider, RefreshStatus, WithRefresh } from "@/components/Refresh";
import { WarningLine } from "@/components/WarningLine";
import { type WeekBody, WeekCard } from "@/components/WeekCard";
import { dayDetails, weekView } from "@/lib/dashboard-view";
import { type DataError, describeDataError, isDataError } from "@/lib/data-error";
import { devFixture, devSwitchOn } from "@/lib/db/dev-fixture";
import { readClipLifts, readClipNames, readClipRunSets, readVideoClips } from "@/lib/db/video-clips";
import type { ClipLiftMeta } from "@/lib/video/auto-lines";
import { recordingAllowed, type VideoClipRow } from "@/lib/video/clips";
import { clipsFixture, FIXTURE_NAMES, fixtureRunSets } from "@/lib/video/library-fixture";
import type { ClipNames, RunSets } from "@/lib/video/library-view";
import { loadDashboardData, loadExerciseCategories, loadTrainingForm, loadTrainingPlan, loadWeekDetail, NEXT_SESSION_DAYS } from "@/lib/db/queries";
import type { IsoDate } from "@/lib/db/rows";
import { addDays, isoWeek, isoWeekStart } from "@/lib/dates";
import { formatDay, formatUpdatedAt } from "@/lib/format";
import {
  buildTrainingPlan,
  resolveToday,
  trainingHeader,
  type TrainingHeader,
  type StrengthWeek,
  type TrainingPlan,
  updatedCaption,
  weekSentence,
} from "@/lib/training-view";
import { datedPlan } from "@/lib/week-plan";

type Failed = { readonly kind: "error"; readonly error: DataError; readonly at: Date };
type FormState = { readonly kind: "ready"; readonly header: TrainingHeader | null } | Failed;
type PlanState = { readonly kind: "ready"; readonly plan: TrainingPlan } | Failed;

/**
 * The form line and the plan load independently: a failed plan read shows the plan's
 * ErrorState (never "Rest day") while the form line renders, and vice versa. Only the data
 * layer's own errors become an error state; anything else is rethrown.
 */
async function loadFormState(today: IsoDate, now: Date): Promise<FormState> {
  try {
    return { kind: "ready", header: trainingHeader(await loadTrainingForm(today), now) };
  } catch (error) {
    if (isDataError(error)) {
      console.error("træning: loading form failed", error);
      return { kind: "error", error, at: new Date() };
    }
    throw error;
  }
}

async function loadPlanState(today: IsoDate): Promise<PlanState> {
  try {
    // The catalogue only words a load (bw-display); a failed read is null and keeps today's words.
    const [data, categories] = await Promise.all([loadTrainingPlan(today), loadExerciseCategories()]);
    return { kind: "ready", plan: buildTrainingPlan(data, today, categories) };
  } catch (error) {
    if (isDataError(error)) {
      console.error("træning: loading plan failed", error);
      return { kind: "error", error, at: new Date() };
    }
    throw error;
  }
}

/**
 * The compact week card's body (review-round.md §7): the current ISO week's daily_load days,
 * weekly_load + weekly_plan's I alt and the strength plan, from the same reads /load uses. A failed
 * read shows ErrorState inside the card only; the "I dag" card is unaffected.
 */
async function loadWeekBody(today: IsoDate, strength: StrengthWeek | null): Promise<WeekBody> {
  try {
    const data = await loadDashboardData();
    const row = data.weeks.find((w) => w.weekStart <= today && today <= w.weekEnd);
    const week = row === undefined ? null : weekView(data, row);
    const [detail, categories] = week === null ? [null, null] : await Promise.all([loadWeekDetail(week.weekStart, week.weekEnd), loadExerciseCategories()]);
    const days = week === null || detail === null ? [] : dayDetails(week, detail, categories);
    const logStart = data.blocks.reduce<IsoDate | null>((min, b) => (min === null || b.startDate < min ? b.startDate : min), null);
    const plan = strength === null ? null : datedPlan(strength, today, days.map((d) => d.date));
    return { kind: "rows", week, days, logStart, today, plan };
  } catch (error) {
    if (isDataError(error)) {
      console.error("træning: loading the week failed", error);
      const at = new Date().toISOString();
      return {
        kind: "message",
        node: (
          <ErrorState
            title="Kunne ikke hente ugen"
            what={describeDataError(error)}
            detail={error.message}
            at={{ iso: at, text: formatUpdatedAt(at) }}
            retry={{ href: "/train" }}
          />
        ),
      };
    }
    throw error;
  }
}

function weekHead(today: IsoDate) {
  const weekStart = isoWeekStart(today);
  return { isoWeek: isoWeek(today).week, weekStart, weekEnd: addDays(weekStart, 6) };
}

/** Streams under its Suspense boundary (skeleton of 5 rows), so the "I dag" card never waits for it. */
async function TrainingWeek({ today, strength, sentence }: { readonly today: IsoDate; readonly strength: StrengthWeek | null; readonly sentence: ReactNode }) {
  return <WeekCard variant="compact" head={weekHead(today)} body={await loadWeekBody(today, strength)} sentence={sentence} className={RIGHT_1} />;
}

/** Træning (/train): "What is my session, and how fresh am I for it?" (design/specs/traening.md §3). */
export async function TrainTab() {
  await connection(); // request time: "today" is the Copenhagen date now, never the build's
  const now = new Date();
  const today = resolveToday(now, process.env);
  const [form, plan] = await Promise.all([loadFormState(today, now), loadPlanState(today)]);
  const header = form.kind === "ready" ? form.header : null;
  const session = plan.kind === "ready" && plan.plan.strength.state === "next" ? plan.plan.strength.next : null;
  const formCard =
    form.kind === "error" ? (
      <FormCard kind="error" retry={plan.kind !== "error"} className={RIGHT_2} />
    ) : (
      <FormCard kind="ready" header={form.header} today={today} className={RIGHT_2} />
    );
  // review-round.md §7: the compact week card is the first card under the header.
  const strengthWeek = plan.kind === "ready" ? plan.plan.strength : null;
  const sentence =
    strengthWeek === null || strengthWeek.columns.length === 0 ? null : session !== null ? (
      <SessionWeekSentence strength={strengthWeek} />
    ) : (
      <p className="sr-only">{weekSentence(strengthWeek.columns, null)}</p>
    );
  const weekCard = (
    <Suspense
      fallback={<WeekCard variant="compact" head={weekHead(today)} body={{ kind: "loading", rows: 5 }} className={RIGHT_1} />}
    >
      <TrainingWeek today={today} strength={strengthWeek} sentence={sentence} />
    </Suspense>
  );
  // Phone: one column (max 640 from sm). Desktop (lg): 7fr | 5fr, DOM order = phone order (reset-traening.md §4).
  const page = (
    <div className="mx-auto flex w-full max-w-160 flex-col gap-3 lg:max-w-none lg:gap-4">
      <header className="flex flex-col gap-2 px-1 pt-1 pb-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-sans text-22 font-semibold text-text">Træning</h1>
          <div>
            <p className="font-mono text-12 text-text-muted tabular-nums">
              <time dateTime={today}>{formatDay(today)}</time>
              {header !== null && (
                <>
                  {" · "}
                  <WithRefresh text={updatedCaption(header.freshness, today)} attention={header.freshness.kind !== "fresh"} />
                </>
              )}
            </p>
            <RefreshStatus />
          </div>
        </div>
        {header !== null && header.freshness.kind !== "fresh" && (
          <WarningLine>
            {header.freshness.kind === "stale"
              ? "Form og styrkeprogrammet kan være forældet."
              : "Opdateringstidspunkt ukendt, så form og styrkeprogrammet kan være forældet."}
          </WarningLine>
        )}
      </header>
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[7fr_5fr] lg:grid-rows-[auto_auto_auto_1fr] lg:items-start lg:gap-4">
        {weekCard}
        {plan.kind === "error" ? (
          <>
            <PlanError error={plan.error} at={plan.at} />
            {formCard}
          </>
        ) : (
          <DayCards plan={plan.plan} today={today} form={formCard} />
        )}
      </div>
    </div>
  );
  // Outside the conditional SetLogProvider: a refetch that adds or drops the session must not
  // remount it (its "data hentet" and the ↻'s focus would be lost).
  return (
    <RefreshProvider>
      {session === null ? (
        page
      ) : (
        <SetLogProvider session={session} date={today} devSwitches={devSwitchOn()}>
          {page}
        </SetLogProvider>
      )}
    </RefreshProvider>
  );
}

/** Desktop grid slots (lg): left = the "I dag" card, then the Sæt card; right = the week card, form, rides (review-round.md §7). */
const LEFT_1 = "lg:col-start-1 lg:row-start-1";
const LEFT_REST = "lg:col-start-1 lg:row-start-2 lg:row-span-3";
const RIGHT_1 = "lg:col-start-2 lg:row-start-1";
const RIGHT_2 = "lg:col-start-2 lg:row-start-2";
const RIGHT_3 = "lg:col-start-2 lg:row-start-3";

/**
 * Phone order (review-round.md §7): the week card (rendered by the page, first), the "I dag" card,
 * the form card, ride card(s), the Sæt card. On desktop the Sæt card (or the rides, when there is no
 * strength) sits under the "I dag" card; the week card, the form card and rides next to strength go right.
 */
function DayCards({ plan, today, form }: { readonly plan: TrainingPlan; readonly today: IsoDate; readonly form: ReactNode }) {
  const strength = plan.strength.state === "next" ? plan.strength.next : null;
  const rides =
    plan.rides.length === 0 ? null : (
      <div className={`flex flex-col gap-3 lg:gap-4 ${strength === null ? LEFT_REST : RIGHT_3}`}>
        {plan.rides.map((ride, i) => (
          <RideCard key={`ride-${i}`} id={`ride-${i + 1}`} ride={ride} />
        ))}
      </div>
    );
  return (
    <>
      {strength !== null ? (
        <SessionBlock today={today} className={LEFT_1} />
      ) : plan.rides.length > 0 ? (
        <RideToday today={today} rides={plan.rides} className={LEFT_1} />
      ) : (
        <RestToday
          today={today}
          next={plan.next}
          lookaheadDays={NEXT_SESSION_DAYS}
          doneToday={plan.doneToday}
          className={LEFT_1}
        />
      )}
      <VideoLibrary today={today} />
      {form}
      {rides}
      {strength !== null && <StrengthCard session={strength} className={LEFT_REST} />}
    </>
  );
}

/**
 * The Optagelser line (clip-line.md; video-library.md): under the day card (desktop: left column). Rows and
 * names are read server-side; a failed read shows the local clips with the rows warning.
 */
async function VideoLibrary({ today }: { readonly today: IsoDate }) {
  const canRecord = recordingAllowed(process.env, process.env.NODE_ENV);
  if (devFixture() === "clips") {
    const f = clipsFixture(today);
    return <ClipLibrary today={today} rows={f.rows} names={FIXTURE_NAMES} runSets={fixtureRunSets(today)} canRecord={canRecord} fixture={{ local: f.local }} />;
  }
  let rows: VideoClipRow[] | null = null;
  let names: ClipNames = { exercises: {}, variants: {} };
  let runSets: RunSets = {};
  let lifts: Record<string, ClipLiftMeta> = {};
  try {
    const now = new Date();
    [rows, names] = await Promise.all([readVideoClips(now), devFixture() === null ? readClipNames() : Promise.resolve(names)]);
    if (devFixture() === null) runSets = await readClipRunSets(rows, now);
  } catch (error) {
    if (!isDataError(error)) throw error;
    console.error("træning: reading video clips failed", error);
  }
  // clip-auto's lift data on its own: if it fails, the clips keep their set numbers and only the
  // pickup waits (review 2026-10-20).
  if (rows !== null && devFixture() === null) {
    try {
      lifts = await readClipLifts(rows, new Date());
    } catch (error) {
      if (!isDataError(error)) throw error;
      console.error("træning: reading the clips' lifts failed", error);
    }
  }
  return <ClipLibrary today={today} rows={rows} names={names} runSets={runSets} canRecord={canRecord} fixture={null} lifts={lifts} />;
}

function PlanError({ error, at }: { readonly error: DataError; readonly at: Date }) {
  return (
    <section aria-label="Dagens træning" className={`rounded-card border border-border bg-card p-5 ${LEFT_1}`}>
      <ErrorState
        title="Kunne ikke hente dagens træning"
        what={describeDataError(error)}
        detail={error.message}
        at={{ iso: at.toISOString(), text: formatUpdatedAt(at.toISOString()) }}
        retry={{ href: "/train" }}
      />
    </section>
  );
}
