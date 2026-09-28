import type { PlanStep } from "@/lib/db/rows";
import {
  formatDuration,
  formatRange,
  formatStepDuration,
  formatWatts,
  spokenRange,
} from "@/lib/format";
import type { RideView } from "@/lib/today-view";

import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { WarningLine } from "./WarningLine";

type RideCardProps = {
  /** Card heading id, e.g. "ride-1". Also prefixes the repeat groups' label ids. */
  readonly id: string;
  readonly ride: RideView;
};

/**
 * A planned ride with Python's targets (watts and % FTP are displayed, never calculated).
 * Durations are per repetition inside a "Repeat N times" group.
 */
export function RideCard({ id, ride }: RideCardProps) {
  const readable = ride.problem === null && ride.steps.length > 0;
  return (
    <Card
      id={id}
      title="Ride"
      action={
        readable ? (
          <p className="text-16 font-semibold tabular-nums">
            Total {formatDuration(ride.totalMinutes * 60)} h
          </p>
        ) : undefined
      }
    >
      <p className="text-20 font-semibold">{ride.name}</p>
      {ride.notes !== null && ride.notes.trim() !== "" && <p className="text-16">{ride.notes}</p>}
      {ride.problem !== null ? (
        <WarningLine>Couldn&apos;t read the steps: {ride.problem}</WarningLine>
      ) : ride.steps.length === 0 ? (
        <EmptyState message="No steps entered for this ride." />
      ) : (
        <>
          <p className="text-14 text-text-muted">
            {ride.ftp === null ? (
              "No FTP from intervals.icu, so targets are in % FTP only."
            ) : (
              <>
                Targets from FTP <span className="whitespace-nowrap">{formatWatts(ride.ftp)}</span>
              </>
            )}
          </p>
          <ol aria-label="Workout steps" className="flex flex-col">
            {ride.steps.map((item, i) => (
              <li key={i} className={i > 0 ? "border-t border-border" : undefined}>
                {item.kind === "step" ? (
                  <StepRow step={item} />
                ) : (
                  <>
                    <p id={`${id}-repeat-${i}`} className="pt-3 text-16 font-semibold">
                      Repeat {item.repeat} {item.repeat === 1 ? "time" : "times"}
                    </p>
                    <ol
                      aria-labelledby={`${id}-repeat-${i}`}
                      className="flex flex-col border-l-2 border-(color:--chart-mark) pl-4"
                    >
                      {item.steps.map((step, j) => (
                        <li key={j} className={j > 0 ? "border-t border-border" : undefined}>
                          <StepRow step={step} />
                        </li>
                      ))}
                    </ol>
                  </>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}

/**
 * Left: label (text-20 semibold) over the duration (text-20). Right: watts (text-28 bold) over
 * % FTP (text-16 muted); without watts (no FTP) the % FTP takes the big line.
 */
function StepRow({ step }: { readonly step: PlanStep }) {
  const duration = formatStepDuration(step.minutes);
  const pct = formatRange(step.pctLow, step.pctHigh);
  const watts =
    step.wattsLow === null || step.wattsHigh === null ? null : formatRange(step.wattsLow, step.wattsHigh);
  const spoken = [
    step.label,
    duration,
    watts === null ? null : `${spokenRange(watts)} watts`,
    `${spokenRange(pct)}% FTP`,
  ]
    .filter((part) => part !== null)
    .join(", ");
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
      <span className="sr-only">{spoken}</span>
      <p aria-hidden="true" className="flex flex-col text-20">
        {step.label === null ? (
          <span className="font-semibold">{duration}</span>
        ) : (
          <>
            <span className="font-semibold">{step.label}</span>
            <span>{duration}</span>
          </>
        )}
      </p>
      <p aria-hidden="true" className="ml-auto flex flex-col items-end text-right">
        {/* nowrap: a range never breaks after its en dash ("125–" / "188 W"). */}
        {watts === null ? (
          <span className="text-28 font-bold whitespace-nowrap tabular-nums">
            {pct}%<span className="text-20"> FTP</span>
          </span>
        ) : (
          <>
            <span className="text-28 font-bold whitespace-nowrap tabular-nums">
              {watts}
              <span className="text-20"> W</span>
            </span>
            <span className="text-16 text-text-muted tabular-nums">{pct}% FTP</span>
          </>
        )}
      </p>
    </div>
  );
}
