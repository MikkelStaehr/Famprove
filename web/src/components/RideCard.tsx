import type { PlanStep } from "@/lib/db/rows";
import {
  formatDuration,
  formatRange,
  formatStepDuration,
  formatWatts,
  spokenRange,
} from "@/lib/format";
import type { RideView } from "@/lib/training-view";

import { EmptyState } from "./EmptyState";
import { Icon } from "./icons";
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
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3.5 rounded-card border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="flex h-lh shrink-0 items-center text-16">
            <Icon name="bike" size={18} className="text-text" />
          </span>
          <h2 id={id} className="min-w-0 font-sans text-16 font-medium text-text">
            Cykel · {ride.name}
          </h2>
        </div>
        {readable && (
          <p className="shrink-0 font-mono text-12 text-text-muted uppercase tabular-nums">
            I alt {formatDuration(ride.totalMinutes * 60)} t
          </p>
        )}
      </div>
      {ride.notes !== null && ride.notes.trim() !== "" && <p className="text-14 text-text">{ride.notes}</p>}
      {ride.problem !== null ? (
        <WarningLine>
          {`Kunne ikke læse trinene, så der vises ingen mål. Ret dem i planned_sessions (${ride.problem}).`}
        </WarningLine>
      ) : ride.steps.length === 0 ? (
        <EmptyState message="Der er ikke indtastet trin for denne tur." />
      ) : (
        <>
          <p className="text-13 text-text-muted">
            {ride.ftp === null ? (
              "Ingen FTP fra intervals.icu, så målene står kun i % FTP."
            ) : (
              <>
                Mål ud fra FTP <span className="whitespace-nowrap">{formatWatts(ride.ftp)}</span>
              </>
            )}
          </p>
          <ol aria-label="Trin" className="flex flex-col">
            {ride.steps.map((item, i) => (
              <li key={i} className="border-t border-border">
                {item.kind === "step" ? (
                  <StepRow step={item} />
                ) : (
                  <>
                    <p id={`${id}-repeat-${i}`} className="pt-2.5 pb-1 font-mono text-12 text-text-muted uppercase">
                      Gentag <span className="tabular-nums">{item.repeat}</span> {item.repeat === 1 ? "gang" : "gange"}
                    </p>
                    <ol
                      aria-labelledby={`${id}-repeat-${i}`}
                      className="flex flex-col border-l border-axis pl-3"
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
    </section>
  );
}

/**
 * Left: label (text-20 500) over the duration (text-20). Right: watts (Inter 500 text-28 tabular) over
 * % FTP (text-14 muted); without watts (no FTP) the % FTP takes the big line.
 */
function StepRow({ step }: { readonly step: PlanStep }) {
  const duration = formatStepDuration(step.minutes);
  const pct = formatRange(step.pctLow, step.pctHigh);
  const watts =
    step.wattsLow === null || step.wattsHigh === null ? null : formatRange(step.wattsLow, step.wattsHigh);
  const spoken = [
    step.label,
    duration,
    watts === null ? null : `${spokenRange(watts)} watt`,
    `${spokenRange(pct)}% FTP`,
  ]
    .filter((part) => part !== null)
    .join(", ");
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
      <span className="sr-only">{spoken}</span>
      <p aria-hidden="true" className="flex flex-col">
        {step.label === null ? (
          <span className="font-mono text-15 font-medium tabular-nums">{duration}</span>
        ) : (
          <>
            <span className="font-sans text-15 font-medium">{step.label}</span>
            <span className="font-mono text-13 text-text-muted tabular-nums">{duration}</span>
          </>
        )}
      </p>
      <p aria-hidden="true" className="ml-auto flex flex-col items-end text-right">
        {/* A range never breaks after its en dash ("125–" / "188 W" reads like a 188 W target).
            Only the unit may wrap under it, when the card is narrower than the value (200% text). */}
        {watts === null ? (
          <span className="font-mono text-20 font-medium tabular-nums">
            <span className="whitespace-nowrap">{pct}%</span> FTP
          </span>
        ) : (
          <>
            <span className="font-mono text-20 font-medium tabular-nums">
              <span className="whitespace-nowrap">{watts}</span> W
            </span>
            <span className="font-mono text-12 text-text-muted tabular-nums">{pct}% FTP</span>
          </>
        )}
      </p>
    </div>
  );
}
