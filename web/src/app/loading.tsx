import { SkeletonBar as Bar } from "@/components/Skeleton";
import { ZoneBarSkeleton } from "@/components/ZoneBar";

const ROWS = 4;

/**
 * Today's skeleton (the nav is real, from the layout): the real h1 with a bar for the date, a bar
 * for the updated line, the compact ZoneBar skeleton, then one card with a title bar, the progress
 * bar and tick rows (28px circle, name bar, prescription bar). Pulses only under motion-safe.
 */
export default function Loading() {
  return (
    <>
      <header className="flex flex-col">
        <h1 className="flex items-baseline gap-x-3">
          <span className="font-display text-44 font-extrabold tracking-[-0.01em] uppercase italic">I dag</span>
          <Bar className="w-1/4 text-16" />
        </h1>
        <div aria-hidden="true" className="mt-1">
          <Bar className="w-1/3 text-14" />
        </div>
        <div className="mt-3">
          <ZoneBarSkeleton size="compact" />
        </div>
      </header>
      <p className="sr-only" role="status">
        Henter dagens plan …
      </p>

      {/* Card shape (Card.tsx, variant "session") without a heading: the title isn't known yet. */}
      <div aria-hidden="true" className="flex flex-col gap-3 rounded-card bg-surface px-4 pt-6 pb-4 shadow-card">
        <Bar className="w-1/3 text-32" />
        <span className="block h-2 rounded-mark bg-track motion-safe:animate-pulse" />
        <div className="flex flex-col">
          {Array.from({ length: ROWS }, (_, i) => (
            <div key={i} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 px-1 py-2">
              <span className="col-start-2 row-start-1">
                <Bar className="w-1/2 text-20" />
              </span>
              <span className="col-start-1 row-start-2 flex h-lh items-end pb-1 text-32">
                <span className="size-7 rounded-full bg-track motion-safe:animate-pulse" />
              </span>
              <span className="col-start-2 row-start-2">
                <Bar className="w-2/3 text-32" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
