import Link from "next/link";


/**
 * Fokus's skeleton (§5): the real Afslut link, a count bar, the 8px progress track, the empty
 * 44px last-tap row, a --track card in the set card's shape (name bar, two 56px bars, the 64px
 * Udført pill) and the 48px Spring over pill. Pulses only under motion-safe.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-phone flex-col">
      <h1 className="sr-only">Fokus</h1>
      <p className="sr-only" role="status">
        Henter sættet …
      </p>
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex min-h-11 shrink-0 items-center rounded-pill border-2 border-text-muted px-4 text-16 font-semibold text-text"
        >
          Afslut
        </Link>
        <span aria-hidden="true" className="block h-lh w-2/5 rounded-mark bg-track text-24 motion-safe:animate-pulse" />
      </div>
      <div aria-hidden="true" className="flex flex-col">
        <span className="mt-3 block h-2 rounded-mark bg-track motion-safe:animate-pulse" />
        <span className="mt-2 block min-h-11" />
        <div className="mt-2 flex flex-col rounded-card bg-track px-4 pt-6 pb-4 motion-safe:animate-pulse">
          <span className="block h-lh rounded-mark bg-surface w-3/5 text-32" />
          <span className="block h-lh rounded-mark bg-surface mt-1 w-1/4 text-20" />
          <span className="block h-lh rounded-mark bg-surface mt-4 w-1/2 text-56" />
          <span className="block h-lh rounded-mark bg-surface mt-4 w-1/5 text-14" />
          <span className="block h-lh rounded-mark bg-surface w-2/5 text-56" />
          <span className="mt-6 block min-h-16 rounded-pill bg-surface" />
        </div>
        <span className="mt-4 block min-h-12 w-36 self-center rounded-pill bg-track motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
