import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { ErrorState } from "@/components/ErrorState";
import { FormCard } from "@/components/FormCard";
import { RideCard } from "@/components/RideCard";
import { SessionBlock, SessionWeekCard } from "@/components/SessionBlock";
import { SetLogProvider } from "@/components/SetLogProvider";
import { StrengthCard } from "@/components/StrengthCard";
import { RestToday, RideToday } from "@/components/TodayCard";
import { WarningLine } from "@/components/WarningLine";
import { WeekCard } from "@/components/WeekCard";
import { type DataError, describeDataError, isDataError } from "@/lib/data-error";
import { devFixture } from "@/lib/db/dev-fixture";
import { loadTrainingForm, loadTrainingPlan, NEXT_SESSION_DAYS } from "@/lib/db/queries";
import type { IsoDate } from "@/lib/db/rows";
import { formatDay, formatUpdatedAt } from "@/lib/format";
import {
  buildTrainingPlan,
  resolveToday,
  trainingHeader,
  type TrainingHeader,
  type TrainingPlan,
  updatedCaption,
  weekSentence,
} from "@/lib/training-view";

export const metadata: Metadata = {
  title: "Træning",
};

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
    return { kind: "ready", plan: buildTrainingPlan(await loadTrainingPlan(today), today) };
  } catch (error) {
    if (isDataError(error)) {
      console.error("træning: loading plan failed", error);
      return { kind: "error", error, at: new Date() };
    }
    throw error;
  }
}

/** Under `next dev` with DEV_TODAY or DEV_FIXTURE taps are not saved (lib/db/set-log.ts says so too). */
function devSwitchesOn(): boolean {
  return process.env.NODE_ENV === "development" && (Boolean(process.env.DEV_TODAY) || devFixture() !== null);
}

/** `/`: "What is my session, and how fresh am I for it?" (design/specs/traening.md §3). */
export default async function TrainingPage() {
  await connection(); // request time: "today" is the Copenhagen date now, never the build's
  const now = new Date();
  const today = resolveToday(now, process.env);
  const [form, plan] = await Promise.all([loadFormState(today, now), loadPlanState(today)]);
  const header = form.kind === "ready" ? form.header : null;
  const session = plan.kind === "ready" && plan.plan.strength.state === "next" ? plan.plan.strength.next : null;
  const formCard =
    form.kind === "error" ? (
      <FormCard kind="error" retry={plan.kind !== "error"} className={RIGHT_1} />
    ) : (
      <FormCard kind="ready" header={form.header} today={today} className={RIGHT_1} />
    );
  // Phone: one column (max 640 from sm). Desktop (lg): 7fr | 5fr, DOM order = phone order (reset-traening.md §4).
  const page = (
    <div className="mx-auto flex w-full max-w-160 flex-col gap-3 lg:max-w-none lg:gap-4">
      <header className="flex flex-col gap-2 px-1 pt-1 pb-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-sans text-22 font-semibold text-text">Træning</h1>
          <p className="font-mono text-12 text-text-muted tabular-nums">
            <time dateTime={today}>{formatDay(today)}</time>
            {header !== null && <> · {updatedCaption(header.freshness, today)}</>}
          </p>
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
  return session === null ? (
    page
  ) : (
    <SetLogProvider session={session} date={today} devSwitches={devSwitchesOn()}>
      {page}
    </SetLogProvider>
  );
}

/** Desktop grid slots (lg): left = the "I dag" card, then the main list; right = form, rides, Uge. */
const LEFT_1 = "lg:col-start-1 lg:row-start-1";
const LEFT_REST = "lg:col-start-1 lg:row-start-2 lg:row-span-3";
const RIGHT_1 = "lg:col-start-2 lg:row-start-1";
const RIGHT_2 = "lg:col-start-2 lg:row-start-2";
const RIGHT_3 = "lg:col-start-2 lg:row-start-3";

/**
 * Phone order (reset-traening.md §2): the "I dag" card, the form card, ride card(s), the Sæt card,
 * the Uge card. On desktop the Sæt card (or the rides, when there is no strength) sits under the
 * "I dag" card; the form card, rides next to strength, and the Uge card go right.
 */
function DayCards({ plan, today, form }: { readonly plan: TrainingPlan; readonly today: IsoDate; readonly form: ReactNode }) {
  const strength = plan.strength.state === "next" ? plan.strength.next : null;
  const rides =
    plan.rides.length === 0 ? null : (
      <div className={`flex flex-col gap-3 lg:gap-4 ${strength === null ? LEFT_REST : RIGHT_2}`}>
        {plan.rides.map((ride, i) => (
          <RideCard key={`ride-${i}`} id={`ride-${i + 1}`} ride={ride} />
        ))}
      </div>
    );
  const weekSlot = strength !== null && plan.rides.length > 0 ? RIGHT_3 : RIGHT_2;
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
      {form}
      {rides}
      {strength !== null && <StrengthCard session={strength} className={LEFT_REST} />}
      {strength !== null ? (
        <SessionWeekCard strength={plan.strength} today={today} className={weekSlot} />
      ) : (
        <WeekCard
          strength={plan.strength}
          today={today}
          sentence={plan.strength.columns.length === 0 ? null : weekSentence(plan.strength.columns, null)}
          className={weekSlot}
        />
      )}
    </>
  );
}

function PlanError({ error, at }: { readonly error: DataError; readonly at: Date }) {
  return (
    <section aria-label="Dagens træning" className={`rounded-card border border-border bg-card p-5 ${LEFT_1}`}>
      <ErrorState
        title="Kunne ikke hente dagens træning"
        what={describeDataError(error)}
        detail={error.message}
        at={{ iso: at.toISOString(), text: formatUpdatedAt(at.toISOString()) }}
        retry={{ href: "/" }}
      />
    </section>
  );
}
