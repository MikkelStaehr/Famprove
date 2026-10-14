import type { ReactNode } from "react";

import type { IsoDate } from "@/lib/db/rows";
import { formatDay, stopAfter } from "@/lib/format";
import { type StrengthWeek, weekdayLabel, weekRange } from "@/lib/training-view";
import { planLabel, type WeekRow, weekRows } from "@/lib/week-plan";

import { Icon } from "./icons";
import { ActivityWords, hasActivityWords } from "./MovingTime";

/**
 * The Uge card (reset-traening.md §2.6, mockup A's list): this ISO week's strength sessions as
 * ListRows in session order. Done ones carry their day and activity words; today's (the next
 * session) says "I DAG" in --today, the page's only orange; later ones have no date until done.
 * `sentence` is the week's sr sentence (weekSentence), rendered after the head. The rows come from
 * lib/week-plan.ts, the same source /load's week list uses.
 */
export function WeekCard({
  strength,
  today,
  sentence,
  className,
}: {
  readonly strength: StrengthWeek;
  readonly today: IsoDate;
  readonly sentence: string | null;
  readonly className?: string;
}) {
  const rows = weekRows(strength);
  return (
    <section
      aria-labelledby="week-heading"
      className={`flex min-w-0 flex-col gap-3 rounded-half border border-border bg-card p-4${className === undefined ? "" : ` ${className}`}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="week-heading" className="font-sans text-16 font-medium text-text">
          Uge <span className="font-mono">{strength.isoWeek}</span>
        </h2>
        <span className="font-mono text-12 text-text-muted uppercase">{weekRange(today)}</span>
      </div>
      {sentence !== null && <p className="sr-only">{sentence}</p>}
      {rows.length > 0 && (
        <ul aria-label="Styrkesessioner i denne uge" className="flex flex-col">
          {rows.map((row) => (
            <WeekRowItem key={row.kind === "extra" ? `x${row.done.date}` : `s${row.session}`} row={row} today={today} />
          ))}
        </ul>
      )}
      {strength.state === "all_done" ? (
        <WeekNote
          title={
            strength.planned === 1 ? "Ugens session er udført." : `Alle ${strength.planned} sessioner er udført i denne uge.`
          }
          body={
            <>
              Næste uges session 1 vises her fra{" "}
              <time dateTime={strength.nextWeekStart}>{formatDay(strength.nextWeekStart)}</time>
              {stopAfter(formatDay(strength.nextWeekStart))}
            </>
          }
        />
      ) : strength.state === "no_program" ? (
        <WeekNote
          title="Intet styrkeprogram i denne uge."
          body={`Trænerens ark har intet for uge ${strength.isoWeek} endnu. Det vises her, når det er tilføjet.`}
        />
      ) : null}
    </section>
  );
}

function WeekNote({ title, body }: { readonly title: string; readonly body: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-15 font-medium text-text">{title}</p>
      <p className="text-14 text-text">{body}</p>
    </div>
  );
}

const ROW = "flex items-center gap-3 border-t border-border py-2.5";
const DAY = "w-9 shrink-0 font-mono text-12";

function WeekRowItem({ row, today }: { readonly row: WeekRow; readonly today: IsoDate }) {
  if (row.kind === "done" || row.kind === "extra") {
    const d = row.done;
    const extra = row.kind === "extra";
    return (
      <li className={ROW}>
        <time dateTime={d.date} className={`${DAY} ${d.isToday ? "text-text" : "text-text-muted"}`}>
          {weekdayLabel(d.date)}
        </time>
        <Icon name="barbell" size={18} className="text-text" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-sans text-14 text-text">{extra ? "Ekstra session" : planLabel(row.session)}</span>
          {hasActivityWords(d.activityName, d.movingTimeS) && (
            <span className="font-sans text-13 text-text-muted">
              <ActivityWords name={d.activityName} movingTimeS={d.movingTimeS} />
            </span>
          )}
        </span>
        {extra ? (
          <span className="shrink-0 text-right font-mono text-12 text-text-muted">ikke i programmet</span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-14 text-text tabular-nums">
            {row.sets !== null && `${row.sets} sæt`}
            <Icon name="check" size={16} className="text-text" />
            <span className="sr-only">udført</span>
          </span>
        )}
      </li>
    );
  }
  if (row.kind === "current") {
    return (
      <li className={ROW}>
        <time dateTime={today} className={`${DAY} text-text`}>
          {weekdayLabel(today)}
        </time>
        <Icon name="barbell" size={18} className="text-text" />
        <span className="min-w-0 flex-1 font-sans text-14 text-text">{planLabel(row.session)}</span>
        <span className="shrink-0 font-mono text-11 text-today uppercase">I dag</span>
      </li>
    );
  }
  return (
    <li className={ROW}>
      <span className={`${DAY} text-text-muted`}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">ingen dato endnu</span>
      </span>
      <Icon name="barbell" size={18} className="text-text-muted" />
      <span className="min-w-0 flex-1 font-sans text-14 text-text-muted">{planLabel(row.session)}</span>
      <span className="shrink-0 font-mono text-12 text-text-muted">plan</span>
    </li>
  );
}
