import { AnalyseHeaderSkeleton } from "@/components/AnalyseTabs";
import { ANSWER_CARD } from "@/components/AnswerBlock";
import { Card } from "@/components/Card";
import { QUESTION_TITLE } from "@/lib/analyse-answers";
import { ANALYSE_GRID } from "@/lib/analyse-grid";

const BAR = "block rounded-control bg-track motion-safe:animate-pulse";

/**
 * Skeleton in the shape of page.tsx (reset-analyse-cykel.md §7): header and tabs real, three answer
 * cards with the real question caption, a 40px bar and two 13px bars; the chart cards with real
 * titles and --track plot blocks; the same grid classes as the page, so nothing jumps.
 */
export default function Loading() {
  return (
    <>
      <AnalyseHeaderSkeleton current="cykel" />
      <div className={ANALYSE_GRID.grid}>
        {(["eftp", "ef", "volume"] as const).map((q) => (
          <section key={q} aria-labelledby={`svar-${q}`} className={ANSWER_CARD}>
            <h3 id={`svar-${q}`} className="flex min-h-11 items-center font-mono text-11 font-normal text-text-muted uppercase">
              {QUESTION_TITLE[q]}
            </h3>
            <div aria-hidden="true" className="flex flex-col gap-2">
              <span className={`${BAR} h-10 w-1/3`} />
              <span className={`${BAR} h-3.25 w-3/4`} />
              <span className={`${BAR} h-3.25 w-2/3`} />
            </div>
          </section>
        ))}
        <Card id="eftp" level={3} title="eFTP pr. tur" className={ANALYSE_GRID.cykelChart}>
          <div aria-hidden="true" className={`${BAR} h-(--chart-height) w-full`} />
        </Card>
        <Card id="ef" level={3} title="Effektivitet på rolige ture" className={ANALYSE_GRID.cykelChart}>
          <div aria-hidden="true" className={`${BAR} h-(--chart-height) w-full`} />
        </Card>
        <Card id="weeks" level={3} title="Timer og belastning pr. uge" className={ANALYSE_GRID.cykelChart}>
          <div aria-hidden="true" className={`${BAR} h-[262px] w-full`} />
        </Card>
        <div aria-hidden="true" className={`h-14 rounded-card border border-border bg-card ${ANALYSE_GRID.cykelSide}`} />
      </div>
      <p className="sr-only" role="status">
        Henter cykeldata…
      </p>
    </>
  );
}
