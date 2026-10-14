import Link from "next/link";

/**
 * Fokus's skeleton (§5, fokus-instrument.md §6): the real Afslut link, then hairlines and 1px
 * --text-muted placeholder rules where the count, the barcode, the name, the figures, Spring over
 * and Udført (last) will be. No grey blocks, no shimmer.
 */
export default function Loading() {
  const rule = "block h-px bg-text-muted";
  return (
    <div className="mx-auto flex w-full max-w-phone flex-col">
      <h1 className="sr-only">Fokus</h1>
      <p className="sr-only" role="status">
        Henter sættet …
      </p>
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex min-h-11 shrink-0 items-center font-sans text-16 font-medium text-text underline decoration-1 underline-offset-4"
        >
          Afslut
        </Link>
        <span aria-hidden="true" className={`${rule} w-2/5`} />
      </div>
      <div aria-hidden="true" className="flex flex-col">
        <span className="mt-4 block h-6 border-b border-border" />
        <span className="mt-2 block min-h-11" />
        <span className="mt-2 flex h-10 items-end"><span className={`${rule} w-3/5`} /></span>
        <span className="mt-4 block h-px bg-border" />
        <span className="mt-4 flex h-14 items-end"><span className={`${rule} w-1/2`} /></span>
        <span className="mt-4 block h-px bg-border" />
        <span className="mt-4 flex h-14 items-end"><span className={`${rule} w-2/5`} /></span>
        <span className="mt-10 block min-h-12 w-36 self-center border border-text-muted" />
        <span className="mt-10 block min-h-16 border-t border-text-muted" />
      </div>
    </div>
  );
}
