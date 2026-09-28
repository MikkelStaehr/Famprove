import { SkeletonBar as Bar } from "@/components/Skeleton";

const ROWS = 4;

/**
 * Today's skeleton (the nav is real, from the layout): the real h1 with a bar for the date,
 * bars for the updated and form lines, then one card with a title bar and tick rows
 * (28px circle, name bar, prescription bar). Pulses only under motion-safe.
 */
export default function Loading() {
  return (
    <>
      <header className="flex flex-col">
        <h1 className="flex items-center gap-2 text-20 font-bold">
          Today
          <Bar className="w-1/4 text-20" />
        </h1>
        <div aria-hidden="true" className="mt-1">
          <Bar className="w-1/3 text-14" />
        </div>
        <div aria-hidden="true" className="mt-2">
          <Bar className="w-1/2 text-20" />
        </div>
      </header>
      <p className="sr-only" role="status">
        Loading today&apos;s plan…
      </p>

      {/* Card shape (Card.tsx) without a heading: the card's title isn't known yet. */}
      <div aria-hidden="true" className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <Bar className="w-1/4 text-16" />
        <div className="flex flex-col">
          {Array.from({ length: ROWS }, (_, i) => (
            <div
              key={i}
              className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 border-t border-border py-3 first:border-t-0"
            >
              <span className="col-start-2 row-start-1">
                <Bar className="w-1/2 text-20" />
              </span>
              <span className="col-start-1 row-start-2 flex h-lh items-center text-28">
                <span className="size-7 rounded-full bg-border motion-safe:animate-pulse" />
              </span>
              <span className="col-start-2 row-start-2">
                <Bar className="w-2/3 text-28" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
