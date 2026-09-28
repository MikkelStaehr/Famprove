import type { Metadata } from "next";
import { connection } from "next/server";

import { ErrorState } from "@/components/ErrorState";
import { FormLine, FormLineError } from "@/components/FormLine";
import { RestCard } from "@/components/RestCard";
import { RideCard } from "@/components/RideCard";
import { StrengthCard } from "@/components/StrengthCard";
import { UpdatedLine } from "@/components/UpdatedLine";
import { type DataError, describeDataError, isDataError } from "@/lib/data-error";
import { loadTodayForm, loadTodayPlan, NEXT_SESSION_DAYS } from "@/lib/db/queries";
import type { IsoDate } from "@/lib/db/rows";
import { formatDay, formatUpdatedAt } from "@/lib/format";
import {
  buildTodayPlan,
  resolveToday,
  todayHeader,
  type TodayHeader,
  type TodayPlan,
} from "@/lib/today-view";

export const metadata: Metadata = {
  title: "Today · Training load",
};

type Failed = { readonly kind: "error"; readonly error: DataError; readonly at: Date };
type FormState = { readonly kind: "ready"; readonly header: TodayHeader | null } | Failed;
type PlanState = { readonly kind: "ready"; readonly plan: TodayPlan } | Failed;

/**
 * The form line and the plan load independently: a failed plan read shows the plan's
 * ErrorState (never "Rest day") while the form line renders, and vice versa. Only the data
 * layer's own errors become an error state; anything else is rethrown.
 */
async function loadFormState(today: IsoDate, now: Date): Promise<FormState> {
  try {
    return { kind: "ready", header: todayHeader(await loadTodayForm(today), now) };
  } catch (error) {
    if (isDataError(error)) {
      console.error("today: loading form failed", error);
      return { kind: "error", error, at: new Date() };
    }
    throw error;
  }
}

async function loadPlanState(today: IsoDate): Promise<PlanState> {
  try {
    return { kind: "ready", plan: buildTodayPlan(await loadTodayPlan(today), today) };
  } catch (error) {
    if (isDataError(error)) {
      console.error("today: loading plan failed", error);
      return { kind: "error", error, at: new Date() };
    }
    throw error;
  }
}

/** `/`: "What am I doing in this session, and how hard?" (design/specs/today.md). */
export default async function TodayPage() {
  await connection(); // request time: "today" is the Copenhagen date now, never the build's
  const now = new Date();
  const today = resolveToday(now, process.env);
  const [form, plan] = await Promise.all([loadFormState(today, now), loadPlanState(today)]);
  const header = form.kind === "ready" ? form.header : null;
  return (
    <>
      <header className="flex flex-col">
        <h1 className="text-20 font-bold">
          Today
          <span className="font-normal text-text-muted">
            {" · "}
            <time dateTime={today}>{formatDay(today)}</time>
          </span>
        </h1>
        {header !== null && (
          <div className="mt-1">
            <UpdatedLine
              freshness={header.freshness}
              staleNote="Form and the strength plan may be out of date."
              unknownNote="Update time unknown, so form and the strength plan may be out of date."
            />
          </div>
        )}
        <div className={header !== null ? "mt-2" : "mt-1"}>
          {form.kind === "error" ? <FormLineError /> : <FormLine header={form.header} today={today} />}
        </div>
      </header>
      {plan.kind === "error" ? <PlanError error={plan.error} at={plan.at} /> : <DayCards plan={plan.plan} />}
    </>
  );
}

/** Ride card(s) first (short, so a strength list can't push them out of sight), then strength. */
function DayCards({ plan }: { readonly plan: TodayPlan }) {
  return (
    <>
      {plan.rides.map((ride, i) => (
        <RideCard key={`ride-${i}`} id={`ride-${i + 1}`} ride={ride} />
      ))}
      {plan.strength.map((session, i) => (
        <StrengthCard
          key={`${session.block}#${session.week}`}
          id={i === 0 ? "strength" : `strength-${i + 1}`}
          date={plan.date}
          session={session}
        />
      ))}
      {plan.kind === "rest" && <RestCard next={plan.next} lookaheadDays={NEXT_SESSION_DAYS} />}
    </>
  );
}

function PlanError({ error, at }: { readonly error: DataError; readonly at: Date }) {
  return (
    <ErrorState
      title="Couldn't load today's plan"
      what={describeDataError(error)}
      detail={error.message}
      at={{ iso: at.toISOString(), text: formatUpdatedAt(at.toISOString()) }}
      retry={{ href: "/" }}
    />
  );
}
