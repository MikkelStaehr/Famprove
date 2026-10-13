"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { BEGIN_UNDONE_TEXT, beginUndone } from "@/lib/fokus-view";
import { setKey } from "@/lib/set-taps";
import { type WeekColumn, weekSentence } from "@/lib/training-view";

import { ArrowIcon } from "./fokus/Instrument";
import { PRIMARY } from "./instrument";
import { useSession } from "./SetLogProvider";
import { settle } from "./useSetLog";
import { WeekColumns } from "./WeekColumns";

/**
 * Træning's header session block (spec traening.md §3.1.4): which session, then the one primary
 * action. Begynd / Fortsæt writes "begin" on the first open set (only when it has no start yet)
 * and opens Fokus once that save has landed (at most FLUSH_WAIT_MS), so Fokus reads it back.
 * Every set closed: the finished note, no button. The week columns (instrument-traening.md §2.2)
 * sit right of the heading, with their sr sentence after the h2.
 */
export function SessionBlock({ columns }: { readonly columns: readonly WeekColumn[] }) {
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
  return (
    <section aria-labelledby="session-heading" className="mt-6 flex flex-col">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="session-heading" className="font-sans text-20 font-normal">
            Styrke: session {session.session} af {session.of}
          </h2>
          <p className="sr-only">{weekSentence(columns, view.segments)}</p>
          <p className="text-16 text-text-muted">
            {session.block} · uge {session.week}
          </p>
        </div>
        <WeekColumns columns={columns} current={view.segments} className="mb-1.5" />
      </div>
      <p ref={status} className="sr-only" role="status" />
      {view.primary === "finished" ? (
        <div className="mt-3 flex flex-col">
          <p className="text-20 font-medium">Alle sæt er klaret.</p>
          <p className="text-16">Husk at logge kg i arket. Sessionen tæller som udført efter næste opdatering.</p>
        </div>
      ) : (
        <button ref={button} type="button" onClick={begin} className={`mt-4 ${PRIMARY}`}>
          {view.primary === "begin" ? "Begynd træning" : "Fortsæt træning"}
          <ArrowIcon />
        </button>
      )}
    </section>
  );
}
