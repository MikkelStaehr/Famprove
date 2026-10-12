import Link from "next/link";

import { ErrorState } from "@/components/ErrorState";
import { type DataError, describeDataError } from "@/lib/data-error";
import { formatUpdatedAt } from "@/lib/format";

const INK_PILL =
  "inline-flex min-h-11 items-center justify-center rounded-pill bg-text px-6 text-16 font-semibold text-bg";
const AFSLUT =
  "inline-flex min-h-11 items-center rounded-pill border-2 border-text-muted px-4 text-16 font-semibold text-text";

/** No session to train (§5 states c/d/e, DEV_FIXTURE=empty): a centred note and the way back. */
export function NoSessionNote({ sentence, devSwitches }: { readonly sentence: string; readonly devSwitches: boolean }) {
  return (
    <div className="flex flex-col">
      <h1 className="sr-only">Fokus</h1>
      <section
        aria-labelledby="fokus-none"
        className="mt-2 flex flex-col items-center gap-2 rounded-card bg-surface px-4 pt-6 pb-4 text-center shadow-card"
      >
        <h2 id="fokus-none" className="text-20 font-bold">
          Ingen styrkesession at træne nu.
        </h2>
        <p className="text-16">{sentence}</p>
        <Link href="/" className={`mt-2 ${INK_PILL}`}>
          Til Træning
        </Link>
      </section>
      {devSwitches && <p className="mt-4 text-14 text-text-muted">Testvisning: sæt gemmes ikke.</p>}
    </div>
  );
}

/** A failed plan or set-log read (§5): Fokus can't know the current set, so it stops here. */
export function FokusError({ error, at }: { readonly error: DataError; readonly at: Date }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">Fokus</h1>
      <div>
        <Link href="/" className={AFSLUT}>
          Afslut
        </Link>
      </div>
      <ErrorState
        title="Kunne ikke hente sættet"
        what={describeDataError(error)}
        detail={error.message}
        at={{ iso: at.toISOString(), text: formatUpdatedAt(at.toISOString()) }}
        retry={{ href: "/fokus" }}
      />
    </div>
  );
}
