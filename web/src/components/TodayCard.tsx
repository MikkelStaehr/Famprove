import type { ReactNode } from "react";

import type { IsoDate } from "@/lib/db/rows";
import { formatDuration, formatWatts } from "@/lib/format";
import { type NextDay, type RideView, shortDay } from "@/lib/training-view";

import { Icon, type IconName } from "./icons";

type TodayShellProps = {
  readonly today: IsoDate;
  readonly icon: IconName;
  readonly title: ReactNode;
  readonly summary: ReactNode;
  /** Geist Mono 11 --inverse-muted, under the summary ("BLOK 12 · UGE 3", "NÆSTE TUR · …"). */
  readonly second?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
};

/**
 * Træning's "I dag" card (reset-traening.md §3, mockup C): the one light surface on the page. Same
 * look as the InverseCard primitive, but the "I DAG · ONS 14" caption is the card's h2 (spec §7),
 * so it is written here. --today never appears on it; its focus ring is --inverse-text (`on-inverse`).
 */
export function TodayShell({ today, icon, title, summary, second, children, className }: TodayShellProps) {
  return (
    <section
      aria-labelledby="today-heading"
      className={`on-inverse flex flex-col gap-3 rounded-half bg-inverse-bg p-4.5 text-inverse-text${className === undefined ? "" : ` ${className}`}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="today-heading" className="font-mono text-11 font-normal text-inverse-muted uppercase">
          I dag · <time dateTime={today}>{shortDay(today)}</time>
        </h2>
        <Icon name={icon} size={20} className="text-inverse-text" />
      </div>
      <p className="font-sans text-20 font-semibold text-inverse-text">{title}</p>
      <div className="flex flex-col gap-1">
        <p className="font-sans text-13 text-inverse-muted">{summary}</p>
        {second}
      </div>
      {children}
    </section>
  );
}

/** The mono second line under the summary. */
export function TodaySecond({ children }: { readonly children: ReactNode }) {
  return <p className="font-mono text-11 text-inverse-muted uppercase">{children}</p>;
}

/** "I alt 1:00 t · mål ud fra FTP 230 W" (no FTP: "mål i % FTP"). */
function rideSummary(ride: RideView): string {
  const target = ride.ftp === null ? "mål i % FTP" : `mål ud fra FTP ${formatWatts(ride.ftp)}`;
  return ride.steps.length === 0 || ride.problem !== null
    ? target
    : `I alt ${formatDuration(ride.totalMinutes * 60)} t · ${target}`;
}

/** Kind "ride": the first ride's name; a second ride adds "+ 1 tur mere". The steps follow in the ride card(s). */
export function RideToday({
  today,
  rides,
  className,
}: {
  readonly today: IsoDate;
  readonly rides: readonly RideView[];
  readonly className?: string;
}) {
  const first = rides[0];
  if (first === undefined) return null;
  const more = rides.length - 1;
  return (
    <TodayShell
      today={today}
      icon="bike"
      className={className}
      title={`Cykel · ${first.name}`}
      summary={more > 0 ? `${rideSummary(first)} · + ${more} ${more === 1 ? "tur" : "ture"} mere` : rideSummary(first)}
    />
  );
}

/** Kind "rest": nothing (more) today, and the next planned ride or the lookahead sentence. */
export function RestToday({
  today,
  next,
  lookaheadDays,
  doneToday,
  className,
}: {
  readonly today: IsoDate;
  readonly next: NextDay | null;
  readonly lookaheadDays: number;
  readonly doneToday: boolean;
  readonly className?: string;
}) {
  return (
    <TodayShell
      today={today}
      icon="bike"
      className={className}
      title={doneToday ? "Færdig for i dag" : "Hviledag"}
      summary={doneToday ? "Ikke mere planlagt i dag." : "Intet planlagt i dag."}
      second={
        next === null ? (
          <p className="font-mono text-11 text-inverse-muted">Ingen tur planlagt de næste {lookaheadDays} dage.</p>
        ) : (
          <>
            <TodaySecond>
              Næste tur · {next.isTomorrow ? "i morgen · " : ""}
              <time dateTime={next.date}>{shortDay(next.date)}</time>
            </TodaySecond>
            <ul className="flex flex-col font-sans text-13 text-inverse-text">
              {next.rides.map((name, i) => (
                <li key={i}>{name}</li>
              ))}
            </ul>
          </>
        )
      }
    />
  );
}
