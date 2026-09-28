import { formatDay } from "@/lib/format";
import type { NextDay } from "@/lib/today-view";

import { Card } from "./Card";
import { EmptyState } from "./EmptyState";

type RestCardProps = {
  /** The first later date with something planned (every session on it), or null. */
  readonly next: NextDay | null;
  /** How far ahead `next` was looked for (queries.NEXT_SESSION_DAYS). */
  readonly lookaheadDays: number;
};

/** Nothing planned today: say so, and what comes next. Only shown when the plan read succeeded. */
export function RestCard({ next, lookaheadDays }: RestCardProps) {
  return (
    <Card id="rest" title="Rest day">
      <p className="text-20">Nothing planned today.</p>
      {next === null ? (
        <EmptyState
          message={`No session planned in the next ${lookaheadDays} days. Rides come from planned_sessions, strength from the coach's sheet.`}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <h3 className="text-14 font-semibold text-text-muted">Next session</h3>
          <p className="text-20 font-semibold">
            <time dateTime={next.date}>
              {next.isTomorrow ? `Tomorrow · ${formatDay(next.date)}` : formatDay(next.date)}
            </time>
          </p>
          <ul className="flex flex-col text-16">
            {next.sessions.map((s, i) => (
              <li key={i}>
                {s.kind === "ride" ? `Ride · ${s.name}` : `Strength · ${s.block}, week ${s.week}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
