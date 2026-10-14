import Link from "next/link";

import { Icon } from "@/components/icons";
import { COMPACT_SECONDARY } from "@/components/fokus/Instrument";

/**
 * Fokus's skeleton (reset-fokus.md §7): the real Afslut button, the progress strip's place, then
 * the set view's hero Card at its final height with --raised bars (radius 4) where the name, the
 * caption and the figures will be, and Udført's place last. Static: no shimmer or pulse at all.
 */
export default function Loading() {
  const bar = "block rounded-cell bg-raised";
  return (
    <div className="mx-auto flex w-full max-w-[30rem] flex-1 flex-col">
      <h1 className="sr-only">Fokus</h1>
      <p className="sr-only" role="status">
        Henter sættet …
      </p>
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className={COMPACT_SECONDARY}>
          <Icon name="x" size={18} />
          Afslut
        </Link>
      </div>
      <div aria-hidden="true" className="flex flex-1 flex-col">
        <span className="mt-2 block h-6 border-b border-border" />
        <span className="mt-2 block min-h-11" />
        <span className="mt-4 mb-10 flex flex-col rounded-hero border border-border bg-card p-5">
          <span className={`${bar} h-7 w-3/5`} />
          <span className={`${bar} mt-3 h-4 w-2/5`} />
          <span className="mt-10 flex gap-6">
            <span className={`${bar} h-14 w-14`} />
            <span className={`${bar} h-14 w-14`} />
          </span>
          <span className={`${bar} mt-3 h-14 w-1/2`} />
          <span className={`${bar} mt-3 h-2 w-1/3`} />
        </span>
        <span className="mt-auto block min-h-11" />
        <span className="mt-6 block min-h-14 rounded-button bg-raised" />
      </div>
    </div>
  );
}
