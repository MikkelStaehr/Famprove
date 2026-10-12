import type { ReactNode } from "react";

import { formatDay, stopAfter } from "@/lib/format";
import type { DoneSession, StrengthSession, StrengthWeek } from "@/lib/training-view";

import { Card } from "./Card";
import { SaveNotes, SetChecklist, SetCount, SetSegments } from "./SetChecklist";
import { ActivityWords, hasActivityWords } from "./MovingTime";

type StrengthCardProps = {
  readonly id: string;
  readonly strength: StrengthWeek;
};

/**
 * This ISO week's strength (spec traening.md §3.3, §5): what's done so far, then the next
 * session's sets (k + 1 of N, no date: it has none until it's done), or that the week is done /
 * has no program. The session line and identity sit in the page header (SessionBlock); the
 * per-set parts read the set log from SetLogProvider, which the page puts around the card.
 */
export function StrengthCard({ id, strength }: StrengthCardProps) {
  const next = strength.state === "next" ? strength.next : null;
  return (
    <Card id={id} variant="session" title="Styrke" action={next !== null ? <SetCount /> : undefined}>
      {next !== null && <SetSegments />}
      {strength.done.length > 0 && <DoneList done={strength.done} />}
      {next !== null ? (
        <NextSession session={next} />
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
              <time dateTime={strength.nextWeekStart}>{formatDay(strength.nextWeekStart)}</time>
              {stopAfter(formatDay(strength.nextWeekStart))}
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

/** The next session's sets, as written in the sheet, each with its own tick. */
function NextSession({ session }: { readonly session: StrengthSession }) {
  return (
    <>
      {session.week === 1 && (
        <p className="text-14 text-text-muted">Uge 1 i blokken: ingen kg fra sidste uge at sammenligne med endnu.</p>
      )}
      <SetChecklist />
      <SaveNotes />
      <p className="text-14 text-text-muted">
        Forslag er et skøn ud fra din e1RM og RPE, ikke trænerens tal. Hvert sæt gemmes, når du sætter flueben; kg
        logger du i arket.
      </p>
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
