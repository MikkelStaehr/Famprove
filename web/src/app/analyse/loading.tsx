import { Card } from "@/components/Card";
import { SkeletonBar as Bar } from "@/components/Skeleton";

const BLOCK = "w-full rounded-control bg-track motion-safe:animate-pulse";

/** Skeleton in the shape of page.tsx (analyse.md §8): real headings, hero, three chart cards, disclosure. */
export default function Loading() {
  return (
    <>
      <header className="flex flex-col">
        <h1 className="font-display text-44 font-extrabold tracking-[-0.01em] uppercase italic">Analyse</h1>
        <div aria-hidden="true" className="mt-1">
          <Bar className="w-1/3 text-14" />
        </div>
        <h2 className="mt-4 font-display text-32 leading-none font-extrabold uppercase italic">Cykel</h2>
        <div className="mt-3">
          <p className="text-14 font-bold tracking-[0.04em] uppercase">Estimeret FTP</p>
          <div aria-hidden="true">
            <span className="mt-2 block h-14 w-1/3 rounded-mark bg-track motion-safe:animate-pulse" />
            <Bar className="mt-3 w-3/4 text-16" />
            <Bar className="mt-1 w-2/3 text-14" />
          </div>
        </div>
      </header>
      <p className="sr-only" role="status">
        Henter cykeldata…
      </p>
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
    </>
  );
}
