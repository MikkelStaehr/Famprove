import type { ReactNode } from "react";

import type { IsoDate } from "@/lib/db/rows";
import { formatDay } from "@/lib/format";
import type { DoneSession, StrengthSession, StrengthWeek } from "@/lib/today-view";

import { Card } from "./Card";
import { ExerciseList, TickProgress, TickSegments } from "./ExerciseChecklist";
import { ActivityWords, hasActivityWords } from "./MovingTime";

type StrengthCardProps = {
  readonly id: string;
  /** Today; the tick key date for the rows of the next session. */
  readonly date: IsoDate;
  readonly strength: StrengthWeek;
};

/**
 * This ISO week's strength (spec today.md §3a): what's done so far, then the next session
 * (k + 1 of N, no date: it has none until it's done), or that the week is done / has no program.
 */
export function StrengthCard({ id, date, strength }: StrengthCardProps) {
  const next = strength.state === "next" ? strength.next : null;
  const rowKeys = next?.exercises.map((e) => e.key) ?? [];
  return (
    <Card
      id={id}
      variant="session"
      title="Styrke"
      action={next !== null ? <TickProgress date={date} rowKeys={rowKeys} /> : undefined}
    >
      {next !== null && <TickSegments date={date} rowKeys={rowKeys} />}
      {strength.done.length > 0 && <DoneList done={strength.done} />}
      {next !== null ? (
        <NextSession date={date} session={next} />
      ) : strength.state === "all_done" ? (
        <WeekNote
          title={
            strength.planned === 1
              ? "Ugens session er udført."
              : `Alle ${strength.planned} sessioner er udført i denne uge.`
          }
          body={
            <>
              Næste uges session 1 vises her fra{" "}
              <time dateTime={strength.nextWeekStart}>{formatDay(strength.nextWeekStart)}</time>.
            </>
          }
        />
      ) : (
        <WeekNote
          title="Intet styrkeprogram i denne uge."
          body={`Trænerens ark har intet for uge ${strength.isoWeek} endnu. Det vises her, når det er tilføjet.`}
        />
      )}
    </Card>
  );
}

/** Strength activities logged this week, in session order, each with a --slab ✓ circle (done = slab). */
function DoneList({ done }: { readonly done: readonly DoneSession[] }) {
  return (
    <ul aria-label="Udført i denne uge" className="mt-1 flex flex-col gap-1 border-b border-border pb-3 text-16">
      {done.map((d) => (
        <li key={`${d.session}#${d.date}`} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2">
          <span aria-hidden="true" className="flex h-lh items-center">
            <DoneMark />
          </span>
          <span>
            {d.extra ? "Ekstra session" : `Session ${d.session}`} udført{" "}
            {d.isToday ? "i dag" : <time dateTime={d.date}>{formatDay(d.date)}</time>}
            {hasActivityWords(d.activityName, d.movingTimeS) && (
              <>
                {" · "}
                <ActivityWords name={d.activityName} movingTimeS={d.movingTimeS} />
              </>
            )}
            {d.extra && " · ikke i programmet"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 20px filled --slab circle with a --slab-mark ✓ (the shape carries the meaning). */
function DoneMark() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slab text-slab-mark">
      <svg
        viewBox="0 0 16 16"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m3.5 8.5 3 3 6-7" />
      </svg>
    </span>
  );
}

/** The next session to do, with the rows to tick exactly as written in the sheet. */
function NextSession({ date, session }: { readonly date: IsoDate; readonly session: StrengthSession }) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="text-20 font-bold">
          Session {session.session} af {session.of} i denne uge
        </h3>
        <p className="text-16">
          {session.block} · uge {session.week}
        </p>
        {session.week === 1 && (
          <p className="text-14 text-text-muted">
            Uge 1 i blokken: ingen kg fra sidste uge at sammenligne med endnu.
          </p>
        )}
      </div>
      <ExerciseList date={date} week={session.week} exercises={session.exercises} />
      <p className="text-14 text-text-muted">Flueben forsvinder, når siden genindlæses. Log kg i arket.</p>
    </>
  );
}

/** States (c) and (d): nothing left to do this week. */
function WeekNote({ title, body }: { readonly title: string; readonly body: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-20 font-bold">{title}</p>
      <p className="text-16">{body}</p>
    </div>
  );
}
