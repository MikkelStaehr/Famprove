import { SkeletonBar as Bar } from "@/components/Skeleton";

const GROUPS = 3;

/**
 * Træning's skeleton (instrument-traening.md §3; the nav is real, from the layout): the real h1
 * with a bar for the date, the updated line, the form row (24px), the session block (heading bar,
 * a 48px week-column box, the 56px primary box), then the strength section: heading, hairline, a
 * 20px barcode bar and three 72px group bars. --surface bars, radius 0; pulse only under motion-safe.
 */
export default function Loading() {
  return (
    <div className="flex w-full max-w-phone flex-col gap-10">
      <header className="flex flex-col">
        <h1 className="flex items-baseline gap-x-3">
          <span className="font-sans text-28 font-normal">Træning</span>
          <Bar className="w-1/4 text-16" />
        </h1>
        <div aria-hidden="true" className="mt-1">
          <Bar className="w-1/3 text-14" />
        </div>
        <div aria-hidden="true" className="mt-4 flex flex-col gap-1">
          <Bar className="w-1/5 text-12" />
          <span className="block h-6 w-1/3 bg-raised motion-safe:animate-pulse" />
          <Bar className="w-2/3 text-16" />
        </div>
        <div aria-hidden="true" className="mt-6 flex flex-col">
          <div className="flex items-end justify-between gap-x-4">
            <div className="flex min-w-0 flex-1 flex-col">
              <Bar className="w-2/3 text-20" />
              <Bar className="w-1/2 text-16" />
            </div>
            <span className="block h-12 w-10 shrink-0 bg-raised motion-safe:animate-pulse" />
          </div>
          <span className="mt-4 block h-14 bg-raised motion-safe:animate-pulse" />
        </div>
      </header>
      <p className="sr-only" role="status">
        Henter dagens træning …
      </p>

      {/* Section shape (Card.tsx) without a heading: the title isn't known yet. */}
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="mb-1 border-b border-border pb-2">
          <Bar className="w-1/4 text-20" />
        </div>
        <Bar className="w-1/3 text-24" />
        <span className="block h-5 w-1/2 bg-raised motion-safe:animate-pulse" />
        {Array.from({ length: GROUPS }, (_, g) => (
          <span key={g} className="block h-18 bg-raised motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  );
}
