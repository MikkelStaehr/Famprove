"use client";

import { useRouter } from "next/navigation";

import { setKey } from "@/lib/set-taps";

import { useSession } from "./SetLogProvider";

/**
 * Træning's header session block (spec traening.md §3.1.4): which session, then the one primary
 * action. Begynd / Fortsæt writes "begin" on the first open set (only when it has no start yet)
 * and opens Fokus without waiting for the save. Every set closed: the finished note, no button.
 */
export function SessionBlock() {
  const { session, setLog, view } = useSession();
  const router = useRouter();
  const begin = () => {
    const first = view.first;
    if (first === null) return;
    if (setLog.log.get(setKey(first))?.startedAt == null) setLog.tap("begin", first);
    router.push("/fokus?view=set"); // opens the set view, not a rest view (spec §4.5)
  };
  return (
    <section aria-labelledby="session-heading" className="mt-4 flex flex-col">
      <h2 id="session-heading" className="text-20 font-bold">
        Styrke: session {session.session} af {session.of}
      </h2>
      <p className="text-16">
        {session.block} · uge {session.week}
      </p>
      {view.primary === "finished" ? (
        <div className="mt-3 flex flex-col">
          <p className="text-20 font-bold">Alle sæt er klaret.</p>
          <p className="text-16">Husk at logge kg i arket. Sessionen tæller som udført efter næste opdatering.</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={begin}
          className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-pill bg-text px-6 py-2 font-display text-24 font-extrabold text-bg uppercase italic"
        >
          {view.primary === "begin" ? "Begynd træning" : "Fortsæt træning"}
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12h15m-6-6 6 6-6 6" />
          </svg>
        </button>
      )}
    </section>
  );
}
