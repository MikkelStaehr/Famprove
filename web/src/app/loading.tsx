import { Card } from "@/components/Card";
import { SkeletonBar as Bar } from "@/components/Skeleton";
import { WeekDaysSkeleton } from "@/components/WeekDays";

/** Skeleton in the exact shape of page.tsx: header, hero, chart card, week card. */
export default function Loading() {
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-20 font-bold">Training load</h1>
        <Bar className="w-1/3 text-14" />
      </header>
      <p className="sr-only" role="status">
        Loading training data…
      </p>

      <div aria-hidden="true" className="flex flex-col gap-2">
        <Bar className="w-1/3 text-14" />
        <Bar className="w-1/4 text-40" />
        <Bar className="w-1/2 text-14" />
        <Bar className="w-1/2 text-14" />
      </div>

      <Card id="trend" title="Fitness, fatigue and form">
        <div aria-hidden="true" className="flex flex-col gap-2">
          <Bar className="w-12 text-12" />
          <div className="h-(--chart-height) w-full rounded-control bg-border motion-safe:animate-pulse" />
          <Bar className="w-3/4 text-12" />
        </div>
      </Card>

      <Card id="week" title="This week">
        {/* Week switcher: two 44px step links around the date range. */}
        <div aria-hidden="true" className="flex items-center gap-2">
          <span className="size-11 shrink-0 rounded-control bg-border motion-safe:animate-pulse" />
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
