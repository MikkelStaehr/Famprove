import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { FokusError, NoSessionNote } from "@/components/fokus/FokusNotes";
import { FokusScreen } from "@/components/fokus/FokusScreen";
import { type DataError, isDataError } from "@/lib/data-error";
import { devFixture } from "@/lib/db/dev-fixture";
import { loadExerciseCategories, loadTrainingForm, loadTrainingPlan } from "@/lib/db/queries";
import type { IsoDate } from "@/lib/db/rows";
import { fokusStaleNote, mainLiftKeys, noSessionSentence } from "@/lib/fokus-view";
import { buildTrainingPlan, resolveToday, trainingHeader, type TrainingPlan } from "@/lib/training-view";

export const metadata: Metadata = {
  title: "Fokus · Træning",
};

/** The form row's freshness only (Fokus shows staleness, nothing else of it). A failed read shows nothing (§5). */
async function staleNote(today: IsoDate, now: Date): Promise<string | null> {
  try {
    const header = trainingHeader(await loadTrainingForm(today), now);
    return header === null ? null : fokusStaleNote(header.freshness);
  } catch (error) {
    if (isDataError(error)) {
      console.error("fokus: loading form failed", error);
      return null;
    }
    throw error;
  }
}

type PlanState =
  | { readonly kind: "ready"; readonly plan: TrainingPlan }
  | { readonly kind: "error"; readonly error: DataError; readonly at: Date };

/** The plan and today's set log are one read: a failure of either is Fokus's ErrorState (§5). */
async function planState(today: IsoDate): Promise<PlanState> {
  try {
    return { kind: "ready", plan: buildTrainingPlan(await loadTrainingPlan(today), today) };
  } catch (error) {
    if (isDataError(error)) {
      console.error("fokus: loading plan failed", error);
      return { kind: "error", error, at: new Date() };
    }
    throw error;
  }
}

/** Under `next dev` with DEV_TODAY or DEV_FIXTURE nothing is written (lib/db/set-log.ts): say so before the first tap. */
function devSwitchesOn(): boolean {
  return process.env.NODE_ENV === "development" && (Boolean(process.env.DEV_TODAY) || devFixture() !== null);
}

/** `/fokus`: "What do I lift now?" (design/specs/traening.md §4). The session is the one Træning shows. */
export default async function FokusPage({ searchParams }: PageProps<"/fokus">) {
  await connection(); // request time: "today" is the Copenhagen date now, never the build's
  const now = new Date();
  const today = resolveToday(now, process.env);
  const [stale, state, params, catalogue] = await Promise.all([
    staleNote(today, now),
    planState(today),
    searchParams,
    loadExerciseCategories(), // a failed read is null: no main lift known, nothing breaks
  ]);
  if (state.kind === "error") {
    return (
      <FokusColumn>
        <FokusError error={state.error} at={state.at} />
      </FokusColumn>
    );
  }
  const { strength } = state.plan;
  const devSwitches = devSwitchesOn();
  if (strength.state !== "next" || strength.next === null) {
    return (
      <FokusColumn>
        <NoSessionNote
          sentence={noSessionSentence(strength.state === "next" ? "all_done" : strength.state, strength.planned)}
          devSwitches={devSwitches}
        />
      </FokusColumn>
    );
  }
  const next = strength.next;
  return (
    <FokusColumn>
      <FokusScreen
        session={{
          session: next.session,
          week: next.week,
          exercises: next.exercises,
          order: next.order,
          log: next.log,
          pairs: next.pairs,
        }}
        date={today}
        staleNote={stale}
        devSwitches={devSwitches}
        enteredFromTraening={params.view === "set"}
        mainLifts={mainLiftKeys(catalogue)}
      />
    </FokusColumn>
  );
}

/**
 * Phone-first screen (DESIGN.md Part A, reset-fokus.md §6): one 480px column at every width,
 * centred (no nav, no edge to hang from). main's top padding puts the top bar 12px (or the safe-area
 * inset) from the top.
 */
function FokusColumn({ children }: { readonly children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[30rem] flex-1 flex-col">{children}</div>;
}
