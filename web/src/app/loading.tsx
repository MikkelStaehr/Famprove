import { SkeletonBar as Bar } from "@/components/Skeleton";

const GROUPS = 2;
const LINES = 2;

/**
 * Træning's skeleton (spec traening.md §5; the nav is real, from the layout): the real h1 with a
 * bar for the date, a bar for the updated line, the form row (a 32px pill + a hint bar), the
 * session block (two text bars and the 56px button pill), then one card with a title bar, the
 * progress bar and two set groups (name, prescription, reference, two 44px set lines). Pulses
 * only under motion-safe.
 */
export default function Loading() {
  return (
    <>
      <header className="flex flex-col">
        <h1 className="flex items-baseline gap-x-3">
          <span className="font-display text-44 font-extrabold tracking-[-0.01em] uppercase italic">Træning</span>
          <Bar className="w-1/4 text-16" />
        </h1>
        <div aria-hidden="true" className="mt-1">
          <Bar className="w-1/3 text-14" />
        </div>
        <div aria-hidden="true" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="block h-8 w-45 rounded-pill bg-track motion-safe:animate-pulse" />
          <Bar className="w-1/2 text-16" />
        </div>
        <div aria-hidden="true" className="mt-4 flex flex-col">
          <Bar className="w-1/2 text-20" />
          <Bar className="w-2/3 text-16" />
          <span className="mt-3 block h-14 rounded-pill bg-track motion-safe:animate-pulse" />
        </div>
      </header>
      <p className="sr-only" role="status">
        Henter dagens træning …
      </p>

      {/* Card shape (Card.tsx, variant "session") without a heading: the title isn't known yet. */}
      <div aria-hidden="true" className="flex flex-col gap-3 rounded-card bg-surface px-4 pt-6 pb-4 shadow-card">
        <Bar className="w-1/3 text-32" />
        <span className="block h-2 rounded-mark bg-track motion-safe:animate-pulse" />
        <div className="flex flex-col">
          {Array.from({ length: GROUPS }, (_, g) => (
            <div key={g} className={`grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 px-1 ${g > 0 ? "mt-3" : ""}`}>
              <span className="col-start-2">
                <Bar className="w-1/2 text-20" />
              </span>
              <span className="col-start-2">
                <Bar className="w-2/3 text-32" />
              </span>
              <span className="col-start-2">
                <Bar className="w-1/2 text-20" />
              </span>
              <span className="col-span-2 mt-1 flex flex-col">
                {Array.from({ length: LINES }, (_, i) => (
                  <span key={i} className="flex min-h-11 items-center py-2">
                    <span className="size-7 rounded-full bg-track motion-safe:animate-pulse" />
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
