import { SkeletonBar as Bar } from "@/components/Skeleton";

/**
 * Træning's skeleton (reset-traening.md §5; the nav is real, from the layout): the real h1 with a
 * bar for the date line, then the "I dag", form and Sæt cards at their final heights (196, 132,
 * 360) in --card, with --raised bars; the pulse runs only under motion-safe. Same frame and grid
 * slots as the page, so nothing jumps when the data arrives.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-160 flex-col gap-3 lg:max-w-none lg:gap-4">
      <header className="flex flex-col gap-0.5 px-1 pt-1 pb-2">
        <h1 className="font-sans text-22 font-semibold text-text">Træning</h1>
        <div aria-hidden="true">
          <Bar className="w-1/2 rounded-cell text-12" />
        </div>
      </header>
      <p className="sr-only" role="status">
        Henter dagens træning …
      </p>
      <div
        aria-hidden="true"
        className="flex flex-col gap-3 lg:grid lg:grid-cols-[7fr_5fr] lg:grid-rows-[auto_auto_1fr] lg:items-start lg:gap-4"
      >
        <div className="flex h-49 flex-col justify-end gap-3 rounded-half border border-border bg-card p-4.5 lg:col-start-1 lg:row-start-1">
          <Bar className="w-2/3 rounded-cell text-20" />
          <Bar className="w-1/2 rounded-cell text-13" />
          <span className="mt-1 block h-12 rounded-button bg-raised motion-safe:animate-pulse" />
        </div>
        <div className="flex h-33 flex-col gap-2.5 rounded-half border border-border bg-card p-4 lg:col-start-2 lg:row-start-1">
          <Bar className="w-1/3 rounded-cell text-12" />
          <Bar className="w-1/2 rounded-cell text-28" />
          <span className="block h-3.5 rounded-cell bg-raised motion-safe:animate-pulse" />
        </div>
        <div className="flex h-90 flex-col gap-4 rounded-card border border-border bg-card p-5 lg:col-start-1 lg:row-start-2 lg:row-span-2">
          <Bar className="w-1/3 rounded-cell text-16" />
          <span className="block h-1.5 rounded-cell bg-raised motion-safe:animate-pulse" />
          <Bar className="w-1/2 rounded-cell text-16" />
          <Bar className="w-1/3 rounded-cell text-20" />
          <span className="block h-13 rounded-cell bg-raised motion-safe:animate-pulse" />
          <span className="block h-13 rounded-cell bg-raised motion-safe:animate-pulse" />
        </div>
      </div>
    </div>
  );
}
