import { hasEstimate, type StrengthSession } from "@/lib/training-view";

import { SetBarcode } from "./SetBarcode";
import { SaveNotes, SetChecklist, SetCount } from "./SetChecklist";

type StrengthCardProps = {
  readonly session: StrengthSession;
  readonly className?: string;
};

/**
 * The Sæt card (reset-traening.md §2.5): the next session's sets, as written in the sheet, each with
 * its own tick, under the set count and the progress strip. The per-set parts read the set log from
 * SetLogProvider, which the page puts around the card. The week's other sessions are in the Uge card.
 */
export function StrengthCard({ session, className }: StrengthCardProps) {
  return (
    <section
      aria-labelledby="sets-heading"
      className={`flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-5${className === undefined ? "" : ` ${className}`}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="sets-heading" className="font-sans text-16 font-medium text-text">
          Session {session.session} · sæt
        </h2>
        <SetCount />
      </div>
      <SetBarcode />
      <SetChecklist />
      <SaveNotes />
      <p className="text-13 text-text-muted">
        {hasEstimate(session) && "Beregnet og ~ kg er appens skøn ud fra dagens sæt og din e1RM, ikke trænerens tal. "}Hvert sæt gemmes, når
        du sætter flueben; kg logger du i arket.
      </p>
    </section>
  );
}
