"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import type { IsoDate } from "@/lib/db/rows";
import { BEGIN_UNDONE_TEXT, beginUndone } from "@/lib/fokus-view";
import { setKey } from "@/lib/set-taps";
import { blockWeekCaption, sessionSummary, type StrengthWeek, weekSentence } from "@/lib/training-view";

import { Icon } from "./icons";
import { INVERSE_BUTTON } from "./InverseCard";
import { useSession } from "./SetLogProvider";
import { TodaySecond, TodayShell } from "./TodayCard";
import { settle } from "./useSetLog";
import { WeekCard } from "./WeekCard";

/**
 * Træning's "I dag" card with a strength session next (reset-traening.md §3; behaviour
 * traening.md §3.1.4): which session, its names and set total, then the one primary action.
 * Begynd / Fortsæt writes "begin" on the first open set (only when it has no start yet) and opens
 * Fokus once that save has landed (at most FLUSH_WAIT_MS), so Fokus reads it back. Every set
 * closed: the finished note, no button.
 */
export function SessionBlock({ today, className }: { readonly today: IsoDate; readonly className?: string }) {
  const { session, setLog, view } = useSession();
  const router = useRouter();
  const button = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  // Back from Fortryd of "Begynd træning" (fokus-pause.md §6): say so, focus Begynd once, drop the query.
  useEffect(() => {
    if (!beginUndone(window.location.search)) return;
    button.current?.focus();
    // After the region is in the tree: many screen readers drop text set as it mounts.
    const timer = window.setTimeout(() => {
      if (status.current !== null) status.current.textContent = BEGIN_UNDONE_TEXT; // once, no re-render
    }, 150);
    window.history.replaceState(null, "", window.location.pathname);
    return () => window.clearTimeout(timer);
  }, []);
  const begin = () => {
    // The warm-up of the first exercise when it is open (fokus-pause.md §6), not its set 1:
    // view.first points a warm-up at set 1 for the checklist's highlight only.
    const at = view.beginAt;
    if (at === null) return;
    if (setLog.log.get(setKey(at))?.startedAt == null) setLog.tap("begin", at);
    void settle(setLog.flush).then(() => router.push("/fokus?view=set")); // the set view (spec §4.5)
  };
  const finished = view.primary === "finished";
  return (
    <TodayShell
      today={today}
      icon="barbell"
      className={className}
      title={finished ? "Alle sæt er klaret." : `Styrke · session ${session.session} af ${session.of}`}
      summary={
        finished
          ? "Husk at logge kg i arket. Sessionen tæller som udført efter næste opdatering."
          : sessionSummary(session.exercises, view.progress)
      }
      second={<TodaySecond>{blockWeekCaption(session.block, session.week)}</TodaySecond>}
    >
      <p ref={status} className="sr-only" role="status" />
      {!finished && (
        <button ref={button} type="button" onClick={begin} className={INVERSE_BUTTON}>
          {view.primary === "begin" ? "Begynd træning" : "Fortsæt træning"}
          <Icon name="arrow-right" size={18} />
        </button>
      )}
    </TodayShell>
  );
}

/** The Uge card with a session in progress: its sr sentence reads the current session's set log. */
export function SessionWeekCard({
  strength,
  today,
  className,
}: {
  readonly strength: StrengthWeek;
  readonly today: IsoDate;
  readonly className?: string;
}) {
  const { view } = useSession();
  return (
    <WeekCard strength={strength} today={today} sentence={weekSentence(strength.columns, view.segments)} className={className} />
  );
}
