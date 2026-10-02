import { AnalyseTabs } from "@/components/AnalyseTabs";
import { Card } from "@/components/Card";
import { SkeletonBar as Bar } from "@/components/Skeleton";
import { E1RM_PANELS_HEIGHT } from "@/lib/analyse-styrke-view";

const BLOCK = "w-full rounded-control bg-track motion-safe:animate-pulse";

/** Skeleton in the shape of styrke/page.tsx (analyse-styrke.md §8): real tabs, hero label and card titles. */
export default function Loading() {
  return (
    <>
      <div className="flex flex-col">
        <AnalyseTabs current="styrke" />
        <h2 className="sr-only">Styrke</h2>
        <div aria-hidden="true" className="mt-2">
          <Bar className="w-1/3 text-14" />
        </div>
        <div className="mt-3">
          <p className="text-14 font-bold tracking-[0.04em] uppercase">Bedste e1RM</p>
          <div aria-hidden="true" className="mt-2 flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-end justify-between gap-3">
                <div className="flex w-1/2 flex-col">
                  <Bar className="w-2/3 text-20" />
                  <Bar className="mt-1 w-full text-14" />
                </div>
                <span className="block h-14 w-1/3 rounded-mark bg-track motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="sr-only" role="status">
        Henter styrkedata…
      </p>
      <Card id="e1rm" variant="calm" level={3} title="Estimeret 1RM pr. uge">
        <div aria-hidden="true" className={`${E1RM_PANELS_HEIGHT} ${BLOCK}`} />
      </Card>
      <Card id="tonnage" variant="calm" level={3} title="Tonnage pr. uge">
        <div aria-hidden="true" className={`h-[372px] ${BLOCK}`} />
      </Card>
    </>
  );
}
