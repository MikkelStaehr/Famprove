import Link from "next/link";

import { type DataError, describeDataError } from "@/lib/data-error";
import { formatUpdatedAt } from "@/lib/format";

import { Icon } from "@/components/icons";

import { COMPACT_SECONDARY, DARK_BOX, Hairline, OUTLINED, PRIMARY_DOCK } from "./Instrument";

/** reset-fokus.md §7: the no-session and error states sit in a Card (radius 22, padding 20). */
const CARD = "flex flex-col rounded-card border border-border bg-card p-5";

/** No session to train (§5 states c/d/e, DEV_FIXTURE=empty): a note and the way back (the view's one fill). */
export function NoSessionNote({ sentence, devSwitches }: { readonly sentence: string; readonly devSwitches: boolean }) {
  return (
    <div className="flex flex-col">
      <h1 className="sr-only">Fokus</h1>
      {devSwitches && <p className="font-mono text-13 text-text-muted">Testvisning: sæt gemmes ikke.</p>}
      <section aria-labelledby="fokus-none" className="mt-2 flex flex-col gap-3">
        <div className={`${CARD} gap-3`}>
          <h2 id="fokus-none" className="font-sans text-20 font-semibold tracking-[-0.01em]">
            Ingen styrkesession at træne nu.
          </h2>
          <Hairline />
          <p className="text-16">{sentence}</p>
        </div>
        <div className={`mt-4 ${PRIMARY_DOCK}`}>
          <Link href="/train" className={DARK_BOX}>
            Til Træning
          </Link>
        </div>
      </section>
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
        <Link href="/train" className={COMPACT_SECONDARY}>
          <Icon name="x" size={18} />
          Afslut
        </Link>
      </div>
      <div role="alert" className={`${CARD} items-start gap-2`}>
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
