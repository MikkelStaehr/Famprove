import { connection } from "next/server";

import { TabShell } from "@/components/TabShell";
import { devFixture } from "@/lib/db/dev-fixture";
import { loadTrainingPlan } from "@/lib/db/queries";
import { type FokusSnapshot, snapshotOf } from "@/lib/fokus-snapshot";
import { fokusView } from "@/lib/fokus-view";
import { setKey } from "@/lib/set-taps";
import { buildTrainingPlan, resolveToday } from "@/lib/training-view";

/**
 * DEV_FIXTURE=minimised / minimised-ready (fokus-minimise.md §4): the snapshot Fokus would have
 * written after the fixture's real taps, by the same writer (snapshotOf). Undefined otherwise.
 */
async function devSnapshot(today: string): Promise<FokusSnapshot | null | undefined> {
  const fixture = devFixture();
  if (fixture !== "minimised" && fixture !== "minimised-ready") return undefined;
  const plan = buildTrainingPlan(await loadTrainingPlan(today), today);
  const next = plan.strength.state === "next" ? plan.strength.next : null;
  if (next === null) return null;
  const log = new Map(next.log.map((l) => [setKey(l), l]));
  const view = fokusView({ exercises: next.exercises, pairs: next.pairs, order: next.order, week: next.week, session: next.session }, log);
  return snapshotOf(today, next.session, view, log.size > 0);
}

/**
 * The three tabs mounted at once (docs/decisions/tab-shell.md §1): each slot renders its page at its
 * own URL, or its default when the URL is another tab's. TabShell stacks them and owns the swipe,
 * and Fokus › Minimér's bar under them.
 */
export default async function TabsLayout({
  train,
  load,
  analyse,
}: {
  readonly children: React.ReactNode;
  readonly train: React.ReactNode;
  readonly load: React.ReactNode;
  readonly analyse: React.ReactNode;
}) {
  await connection(); // request time: "today" is the Copenhagen date now (DEV_TODAY aware)
  const today = resolveToday(new Date(), process.env);
  const snap = await devSnapshot(today);
  return <TabShell pages={[train, load, analyse]} today={today} {...(snap === undefined ? {} : { devSnapshot: snap })} />;
}
