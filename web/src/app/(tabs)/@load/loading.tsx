import { Card } from "@/components/Card";
import { ScreenHeader } from "@/components/ScreenHeader";
import { SkeletonBar as Bar } from "@/components/Skeleton";
import { WeekCard } from "@/components/WeekCard";
import { ZoneBarSkeleton } from "@/components/ZoneBar";
import { LOAD_GRID, LOAD_PLACE } from "@/lib/load-grid";

/** Skeleton in the exact shape of page.tsx (reset-belastning.md §7): the same cards and grid classes. */
export default function Loading() {
  return (
    <>
      <ScreenHeader title="Belastning" line={<Bar className="w-40 text-12" />} />
      <p className="sr-only" role="status">
        Henter træningsdata…
      </p>

      <div className={LOAD_GRID}>
        <section aria-hidden="true" className={`flex flex-col gap-4 rounded-card border border-border bg-card p-5 ${LOAD_PLACE.form}`}>
          <Bar className="w-1/3 text-12" />
          <Bar className="h-14 w-1/2" />
          <ZoneBarSkeleton />
          <Bar className="w-2/3 text-13" />
        </section>

        <div aria-hidden="true" className={`grid grid-cols-2 gap-3 ${LOAD_PLACE.tiles}`}>
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-tile border border-border bg-card p-3.5">
              <Bar className="w-2/3 text-11" />
              <Bar className="w-1/2 text-24" />
              <Bar className="w-3/4 text-11" />
            </div>
          ))}
        </div>

        <WeekCard variant="full" head={null} body={{ kind: "loading", rows: 7 }} className={LOAD_PLACE.week} />

        {/* fitness-round.md §1: the FITNESS caption and a 48px bar for the figure. */}
        <section aria-hidden="true" className={`flex min-w-0 flex-col gap-4.5 rounded-hero border border-border bg-card px-5 pt-5.5 pb-4 ${LOAD_PLACE.curve}`}>
          <div className="flex flex-col gap-1">
            <Bar className="w-1/4 text-12" />
            <Bar className="h-12 w-1/3" />
          </div>
          <div className="h-[196px] w-full rounded-control bg-raised motion-safe:animate-pulse sm:h-[216px] lg:h-[296px]" />
          <Bar className="w-1/2 text-13" />
        </section>

        <Card id="days" title="Træningsdage" className={LOAD_PLACE.grid}>
          <div aria-hidden="true" className="h-[164px] w-[300px] max-w-full rounded-cell bg-raised motion-safe:animate-pulse" />
        </Card>

        <Card id="bars" title="TSS pr. dag" className={LOAD_PLACE.bars}>
          <div aria-hidden="true" className="h-[147px] w-full rounded-cell bg-raised motion-safe:animate-pulse" />
        </Card>

      </div>
    </>
  );
}
