import { AnalyseHeaderSkeleton } from "@/components/AnalyseTabs";
import { Card } from "@/components/Card";
import { MonoCaption } from "@/components/MonoCaption";
import { ANALYSE_GRID } from "@/lib/analyse-grid";

const BAR = "block rounded-control bg-track motion-safe:animate-pulse";

/**
 * Skeleton in the shape of styrke/page.tsx (reset-analyse-styrke.md §8): header and tabs real; the
 * hero with its real caption and three rows (two 12px bars left, a 40px bar right); the chart cards
 * with real titles and --track blocks 18 + 3 × 122 and 18 + 3 × 82 + 30. Same grid as the page.
 */
export default function Loading() {
  return (
    <>
      <AnalyseHeaderSkeleton current="styrke" />
      <div className={ANALYSE_GRID.grid}>
        <section
          aria-label="Bedste e1RM"
          className={`flex flex-col gap-3 rounded-hero border border-border bg-card px-5 pt-5.5 pb-4 ${ANALYSE_GRID.styrkeHero}`}
        >
          <MonoCaption size={12}>Bedste e1RM</MonoCaption>
          <div aria-hidden="true" className="flex flex-col">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-end justify-between gap-3 border-t border-border py-3 first:border-t-0 first:pt-0">
                <div className="flex w-1/2 flex-col gap-1.5">
                  <span className={`${BAR} h-3 w-2/3`} />
                  <span className={`${BAR} h-3 w-full`} />
                </div>
                <span className={`${BAR} h-10 w-1/3`} />
              </div>
            ))}
          </div>
        </section>
        <Card id="e1rm" level={3} title="Estimeret 1RM pr. uge" className={`${ANALYSE_GRID.styrkeChart} lg:row-start-1`}>
          <div aria-hidden="true" className={`${BAR} h-[384px] w-full`} />
        </Card>
        <Card id="tonnage" level={3} title="Tonnage pr. uge" className={`${ANALYSE_GRID.styrkeChart} lg:row-start-2`}>
          <div aria-hidden="true" className={`${BAR} h-[294px] w-full`} />
        </Card>
      </div>
      <p className="sr-only" role="status">
        Henter styrkedata…
      </p>
    </>
  );
}
