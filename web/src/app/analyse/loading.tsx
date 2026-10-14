import { AnalyseTabs } from "@/components/AnalyseTabs";
import { Card } from "@/components/Card";
import { SkeletonBar as Bar } from "@/components/Skeleton";
import { QUESTION_TITLE } from "@/lib/analyse-answers";
import { RAIL_GRID } from "@/lib/rail-grid";

const BLOCK = "w-full bg-raised motion-safe:animate-pulse";

/** Skeleton in the shape of page.tsx (analyse.md §8, §11, §12d): real headings, the three answer blocks in the rail, three chart cards and the disclosure in the main column. */
export default function Loading() {
  return (
    <>
      <div className="flex flex-col">
        <AnalyseTabs current="cykel" />
        <h2 className="sr-only">Cykel</h2>
        <div aria-hidden="true" className="mt-2">
          <Bar className="w-1/3 text-14" />
        </div>
        <div className={RAIL_GRID.grid}>
          <div className={RAIL_GRID.railScroll}>
            {/* §12d: three block skeletons, the real question row, a 56/44px bar, two text bars. */}
            <div className="mt-3 flex flex-col gap-10 lg:mt-0">
              {(["eftp", "ef", "volume"] as const).map((q) => (
                <section key={q} aria-labelledby={`svar-${q}`}>
                  <h3 id={`svar-${q}`} className="caption flex min-h-6 items-center pr-12">
                    {QUESTION_TITLE[q]}
                  </h3>
                  <div aria-hidden="true">
                    <span
                      className={`mt-1 block w-1/3 bg-raised motion-safe:animate-pulse ${q === "eftp" ? "h-14" : "h-11"}`}
                    />
                    <Bar className="mt-2 w-3/4 text-16" />
                    <Bar className="mt-1 w-2/3 text-14" />
                  </div>
                </section>
              ))}
            </div>
          </div>
          <div className={RAIL_GRID.main}>
            <Card id="eftp" variant="calm" level={3} title="eFTP pr. tur">
              <div aria-hidden="true" className={`h-(--chart-height) ${BLOCK}`} />
            </Card>
            <Card id="ef" variant="calm" level={3} title="Effektivitet på rolige ture">
              <div aria-hidden="true" className={`h-(--chart-height) ${BLOCK}`} />
            </Card>
            <Card id="weeks" variant="calm" level={3} title="Timer og belastning pr. uge">
              <div aria-hidden="true" className={`h-[232px] ${BLOCK}`} />
            </Card>
            <div aria-hidden="true" className={`h-11 ${BLOCK}`} />
          </div>
        </div>
      </div>
      <p className="sr-only" role="status">
        Henter cykeldata…
      </p>
    </>
  );
}
