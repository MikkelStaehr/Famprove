import { Card } from "@/components/Card";
import { SkeletonBar as Bar } from "@/components/Skeleton";
import { WeekDaysSkeleton } from "@/components/WeekDays";
import { ZoneBarSkeleton } from "@/components/ZoneBar";

/** Skeleton in the exact shape of page.tsx: header with the hero zone bar, chart card, week card. */
export default function Loading() {
  return (
    <>
      <header className="flex flex-col">
        <h1 className="font-display text-44 font-extrabold tracking-[-0.01em] break-words hyphens-auto uppercase italic">Belastning</h1>
        <div aria-hidden="true" className="mt-1">
          <Bar className="w-1/3 text-14" />
        </div>
        <div className="mt-3">
          <ZoneBarSkeleton size="hero" />
          <div aria-hidden="true">
            <Bar className="mt-3 w-1/2 text-16" />
            <Bar className="mt-1 w-2/3 text-14" />
          </div>
        </div>
      </header>
      <p className="sr-only" role="status">
        Henter træningsdata…
      </p>

      <Card id="trend" variant="calm" title="Fitness, træthed og form">
        <div aria-hidden="true" className="flex flex-col gap-2">
          <Bar className="w-3/4 text-12" />
          <Bar className="w-12 text-12" />
          <div className="h-(--chart-height) w-full rounded-control bg-track motion-safe:animate-pulse" />
        </div>
      </Card>

      <Card id="week" variant="calm" title="Denne uge">
        {/* Week switcher: two 44px step links around the date range. */}
        <div aria-hidden="true" className="flex items-center gap-2">
          <span className="size-11 shrink-0 rounded-pill bg-track motion-safe:animate-pulse" />
          <span className="flex flex-1 flex-col items-center">
            <Bar className="w-2/3 text-14" />
            <Bar className="w-1/3 text-12" />
          </span>
          <span className="size-11 shrink-0" />
        </div>
        <WeekDaysSkeleton rows={7} />
      </Card>
    </>
  );
}
