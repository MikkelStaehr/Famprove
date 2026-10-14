import type { Metadata } from "next";
import { connection } from "next/server";

import { ErrorState } from "@/components/ErrorState";
import { RestCard } from "@/components/RestCard";
import { RideCard } from "@/components/RideCard";
import { SessionBlock } from "@/components/SessionBlock";
import { SetLogProvider } from "@/components/SetLogProvider";
import { StrengthCard } from "@/components/StrengthCard";
import { UpdatedLine } from "@/components/UpdatedLine";
import { ZoneBarError, ZoneFlagRow } from "@/components/ZoneBar";
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
  const columns = plan.kind === "ready" ? plan.plan.strength.columns : [];
  // Phone-first screen: one column at every width, max-w-phone and left-aligned from lg (DESIGN.md Part A).
  const page = (
    <div className="flex w-full max-w-phone flex-col gap-10">
      <header className="flex flex-col">
        <h1 className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-sans text-28 font-normal">Træning</span>
          <span className="sr-only">, </span>
          <time dateTime={today} className="font-sans text-16 font-normal text-text-muted">
            {formatDay(today)}
          </time>
        </h1>
        {header !== null && (
          <div className="mt-1">
            <UpdatedLine
              freshness={header.freshness}
              staleNote="Form og styrkeprogrammet kan være forældet."
              unknownNote="Opdateringstidspunkt ukendt, så form og styrkeprogrammet kan være forældet."
            />
          </div>
        )}
        <div className="mt-4">
          {form.kind === "error" ? (
            <ZoneBarError retry={plan.kind !== "error"} />
          ) : (
            <ZoneFlagRow header={form.header} today={today} />
          )}
        </div>
        {session !== null && <SessionBlock columns={columns} />}
      </header>
      {plan.kind === "error" ? <PlanError error={plan.error} at={plan.at} /> : <DayCards plan={plan.plan} />}
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

/**
 * Ride card(s) first (short, so a strength list can't push them out of sight), then this ISO
 * week's strength (every state of spec §5, including "no program"), then the Rest card when no
 * ride is planned today and no strength session is left.
 */
function DayCards({ plan }: { readonly plan: TrainingPlan }) {
  return (
    <>
      {plan.rides.map((ride, i) => (
        <RideCard key={`ride-${i}`} id={`ride-${i + 1}`} ride={ride} />
      ))}
      <StrengthCard id="strength" strength={plan.strength} />
      {plan.kind === "rest" && (
        <RestCard next={plan.next} lookaheadDays={NEXT_SESSION_DAYS} doneToday={plan.doneToday} />
      )}
    </>
  );
}

function PlanError({ error, at }: { readonly error: DataError; readonly at: Date }) {
  return (
    <ErrorState
      title="Kunne ikke hente dagens træning"
      what={describeDataError(error)}
      detail={error.message}
      at={{ iso: at.toISOString(), text: formatUpdatedAt(at.toISOString()) }}
      retry={{ href: "/" }}
    />
  );
}
