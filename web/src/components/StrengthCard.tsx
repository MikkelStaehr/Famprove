import type { ReactNode } from "react";

import { formatDay, stopAfter } from "@/lib/format";
import { type DoneSession, type StrengthSession, type StrengthWeek, weekSentence } from "@/lib/training-view";

import { Card } from "./Card";
import { CheckIcon } from "./fokus/Instrument";
import { ActivityWords, hasActivityWords } from "./MovingTime";
import { SetBarcode } from "./SetBarcode";
import { SaveNotes, SetChecklist, SetCount } from "./SetChecklist";
import { WeekColumns } from "./WeekColumns";

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
    <Card
      id={id}
      variant="session"
      title="Styrke"
      action={
        // A finished week has no session block: the week columns draw here, all done, no red tick (§3).
        strength.state === "all_done" ? (
          <>
            <WeekColumns columns={strength.columns} current={null} className="self-end" />
            <p className="sr-only">{weekSentence(strength.columns, null)}</p>
          </>
        ) : undefined
      }
    >
      {next !== null && (
        <div className="flex flex-col gap-3">
          <SetCount />
          <SetBarcode />
        </div>
      )}
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

/** Strength activities logged this week, in session order, each with an ink ✓ (inline SVG). */
function DoneList({ done }: { readonly done: readonly DoneSession[] }) {
  return (
    <ul aria-label="Udført i denne uge" className="flex flex-col gap-1 border-b border-border pb-4 text-16">
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

/** An ink ✓, no container (Revision 5: no fills, no radius). */
function DoneMark() {
  return <CheckIcon className="size-5 text-text" />;
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
      <p className="text-20 font-medium">{title}</p>
      <p className="text-16">{body}</p>
    </div>
  );
}
