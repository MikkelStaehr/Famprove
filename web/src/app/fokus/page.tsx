import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { FokusError, NoSessionNote } from "@/components/fokus/FokusNotes";
import { FokusScreen } from "@/components/fokus/FokusScreen";
import { type DataError, isDataError } from "@/lib/data-error";
import { autoFixturePhase, devFixture, devSwitchOn, videoFixture } from "@/lib/db/dev-fixture";
import { recordingAllowed } from "@/lib/video/clips";
import { loadExerciseCategories, loadTrainingForm, loadTrainingPlan } from "@/lib/db/queries";
import type { ExerciseCategoryRow, IsoDate } from "@/lib/db/rows";
import type { PartsData } from "@/lib/set-parts";
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
  | { readonly kind: "ready"; readonly plan: TrainingPlan; readonly parts: PartsData | undefined }
  | { readonly kind: "error"; readonly error: DataError; readonly at: Date };

/** The plan and today's set log are one read: a failure of either is Fokus's ErrorState (§5). */
async function planState(today: IsoDate, categories: readonly ExerciseCategoryRow[] | null): Promise<PlanState> {
  try {
    const data = await loadTrainingPlan(today);
    // combo-parts.md: the parts editor's data goes to Fokus as read (fokusView pre-fills from it).
    return { kind: "ready", plan: buildTrainingPlan(data, today, categories), parts: data.parts };
  } catch (error) {
    if (isDataError(error)) {
      console.error("fokus: loading plan failed", error);
      return { kind: "error", error, at: new Date() };
    }
    throw error;
  }
}

/** `/fokus`: "What do I lift now?" (design/specs/traening.md §4). The session is the one Træning shows. */
export default async function FokusPage({ searchParams }: PageProps<"/fokus">) {
  await connection(); // request time: "today" is the Copenhagen date now, never the build's
  const now = new Date();
  const today = resolveToday(now, process.env);
  // A failed catalogue read is null: no main lift known and the loads keep today's words; nothing breaks.
  const catalogueRead = loadExerciseCategories();
  const [stale, state, params, catalogue] = await Promise.all([
    staleNote(today, now),
    catalogueRead.then((c) => planState(today, c)),
    searchParams,
    catalogueRead,
  ]);
  if (state.kind === "error") {
    return (
      <FokusColumn>
        <FokusError error={state.error} at={state.at} />
      </FokusColumn>
    );
  }
  const { strength } = state.plan;
  const devSwitches = devSwitchOn();
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
          runRows: next.runRows,
          jump: next.jump,
          pairSlots: next.pairSlots,
          partnerData: next.partnerData,
          ...(next.devPartners === undefined ? {} : { devPartners: next.devPartners }),
          ...(state.parts === undefined ? {} : { parts: state.parts }),
        }}
        date={today}
        staleNote={stale}
        devSwitches={devSwitches}
        enteredFromTraening={params.view === "set"}
        mainLifts={mainLiftKeys(catalogue)}
        sheetOpen={devFixture() === "sheet" || devFixture() === "sheet-superset"}
        recording={{ allowed: recordingAllowed(process.env, process.env.NODE_ENV), fixture: videoFixture(devFixture()) }}
        autoFixture={autoFixturePhase(devFixture())}
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
