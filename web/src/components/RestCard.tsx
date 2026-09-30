import { formatDay } from "@/lib/format";
import type { NextDay } from "@/lib/today-view";

import { Card } from "./Card";
import { EmptyState } from "./EmptyState";

type RestCardProps = {
  /** The first later date with a planned ride (every ride on it), or null. */
  readonly next: NextDay | null;
  /** How far ahead `next` was looked for (queries.NEXT_SESSION_DAYS). */
  readonly lookaheadDays: number;
  /** A strength activity was logged today. */
  readonly doneToday: boolean;
};

/**
 * No ride today and no strength session left this week: say so, and the next ride. Rides only;
 * strength's "what's next" lives in the Strength card. Only shown when the plan read succeeded.
 */
export function RestCard({ next, lookaheadDays, doneToday }: RestCardProps) {
  return (
    <Card id="rest" variant="session" title={doneToday ? "Færdig for i dag" : "Hviledag"}>
      <p className="text-20">{doneToday ? "Ikke mere planlagt i dag." : "Intet planlagt i dag."}</p>
      {next === null ? (
        <EmptyState
          message={`Ingen tur planlagt de næste ${lookaheadDays} dage. Ture kommer fra planned_sessions.`}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <h3 className="text-14 font-bold tracking-[0.04em] text-text-muted uppercase">Næste tur</h3>
          <p className="text-20 font-bold">
            <time dateTime={next.date}>
              {next.isTomorrow ? `I morgen · ${formatDay(next.date)}` : formatDay(next.date)}
            </time>
          </p>
          <ul className="flex flex-col text-16">
            {next.rides.map((name, i) => (
              <li key={i}>{name}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
