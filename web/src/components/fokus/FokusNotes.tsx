import Link from "next/link";

import { type DataError, describeDataError } from "@/lib/data-error";
import { formatUpdatedAt } from "@/lib/format";

import { Hairline, INK_LINK, OUTLINED, PRIMARY_FILL } from "./Instrument";

/** No session to train (§5 states c/d/e, DEV_FIXTURE=empty): a note and the way back (the view's one fill). */
export function NoSessionNote({ sentence, devSwitches }: { readonly sentence: string; readonly devSwitches: boolean }) {
  return (
    <div className="flex flex-col">
      <h1 className="sr-only">Fokus</h1>
      <section aria-labelledby="fokus-none" className="mt-2 flex flex-col gap-2">
        <h2 id="fokus-none" className="font-grotesk text-20 font-normal">
          Ingen styrkesession at træne nu.
        </h2>
        <Hairline />
        <p className="text-16">{sentence}</p>
        <Link href="/" className={`mt-4 ${PRIMARY_FILL}`}>
          Til Træning
        </Link>
      </section>
      {devSwitches && <p className="caption mt-4 normal-case tracking-normal">Testvisning: sæt gemmes ikke.</p>}
    </div>
  );
}

/**
 * A failed plan or set-log read (§5): Fokus can't know the current set, so it stops here. The
 * shared ErrorState's copy and roles in Instrument's look (an ink ◆, never red under 24px).
 */
export function FokusError({ error, at }: { readonly error: DataError; readonly at: Date }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">Fokus</h1>
      <div>
        <Link href="/" className={`inline-flex items-center ${INK_LINK}`}>
          Afslut
        </Link>
      </div>
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="flex items-center gap-2 text-16 text-text">
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0" fill="currentColor">
            <path d="M8 1 15 8 8 15 1 8Z" />
          </svg>
          Kunne ikke hente sættet
        </p>
        <p className="text-16">{describeDataError(error)}</p>
        <p className="font-mono text-14 text-text-muted">{error.message}</p>
        <p className="font-mono text-14 text-text-muted">
          Forsøgt <time dateTime={at.toISOString()}>{formatUpdatedAt(at.toISOString())}</time>
        </p>
        <Link href="/fokus" prefetch={false} className={`inline-flex min-h-11 items-center px-4 ${OUTLINED}`}>
          Prøv igen
        </Link>
      </div>
    </div>
  );
}
