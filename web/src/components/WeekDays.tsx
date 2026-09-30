import type {
  DayDetail,
  ExerciseDetail,
  RideDetail,
  SessionDetail,
  StrengthDetail,
  WeekView,
} from "@/lib/dashboard-view";
import {
  formatDay,
  formatDevice,
  formatDuration,
  formatIf,
  formatLoad,
  formatScore,
  formatSetLoad,
  formatWatts,
} from "@/lib/format";

import { ActivityWords, hasActivityWords } from "./MovingTime";
import { SkeletonBar } from "./Skeleton";

/**
 * The selected week's days (daily_load rows) with per-day sessions behind native
 * <details>/<summary> (keyboard and screen-reader accessible without JS), plus the week total
 * from weekly_load. Displays values only; every number comes from Python or SQL.
 *
 * Layout per row: day + three 64px TSS columns when the list is at least 20rem wide (390px
 * phones). Narrower, e.g. at 200% text, the day moves onto its own line above the numbers
 * instead of scrolling sideways.
 */
const ROW = "grid grid-cols-3 gap-x-2 @xs:grid-cols-[minmax(0,1fr)_repeat(3,4rem)]";
const DAY_CELL = "col-span-3 @xs:col-span-1";
/** Day text lines up with the text after a summary's chevron (16px icon + 8px gap). */
const DAY_INDENT = "pl-6";

type WeekDaysProps = {
  readonly week: WeekView;
  readonly days: readonly DayDetail[];
};

export function WeekDays({ week, days }: WeekDaysProps) {
  return (
    <div className="@container flex flex-col">
      <ColumnHeads />
      <ul aria-label={`Days of week ${week.isoWeek}`} className="flex flex-col">
        {days.map((day) => (
          <li key={day.date} className="border-b border-border">
            <DayRow day={day} />
          </li>
        ))}
      </ul>
      <p className={`${ROW} items-center pt-2 text-14 font-semibold`}>
        {/* Flush left (no chevron indent) so "Week NN total" fits one line at 390px. */}
        <span className={DAY_CELL}>Week {week.isoWeek} total</span>
        <Tss label="cycling" value={week.cyclingTss} />
        <Tss label="strength" value={week.strengthTss} />
        <Tss label="total" value={week.totalTss} />
      </p>
    </div>
  );
}

/** Visual column heads; each row carries the same words for screen readers. */
function ColumnHeads() {
  return (
    <div
      aria-hidden="true"
      className={`${ROW} border-b border-border py-2 text-12 font-semibold text-text-muted`}
    >
      <span className={`hidden @xs:block ${DAY_INDENT}`}>Day</span>
      {["Cycling", "Strength", "Total"].map((label) => (
        <span key={label} className="text-right">
          {label}
          <br />
          <span className="font-normal">TSS</span>
        </span>
      ))}
    </div>
  );
}

/** One TSS cell; the label and unit are spoken, the column head shows them visually. */
function Tss({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <span className="text-right tabular-nums">
      <span className="sr-only">, {label} </span>
      {formatLoad(value)}
      <span className="sr-only"> TSS</span>
    </span>
  );
}

function DayRow({ day }: { readonly day: DayDetail }) {
  const numbers = (
    <>
      <Tss label="cycling" value={day.cyclingTss} />
      <Tss label="strength" value={day.strengthTss} />
      <Tss label="total" value={day.totalTss} />
    </>
  );
  if (day.rest) {
    // No session behind the day. "Rest" only when it also carries no load (else show the load).
    const load = formatLoad(day.totalTss) !== "0";
    return (
      <div className={`${ROW} min-h-11 items-center py-2 text-14`}>
        <span className={`${DAY_CELL} ${DAY_INDENT}`}>{formatDay(day.date)}</span>
        {load ? numbers : <span className="col-span-3 text-right text-text-muted">Rest</span>}
      </div>
    );
  }
  return (
    <details className="group">
      <summary className={`${ROW} min-h-11 cursor-pointer list-none items-center py-2 text-14`}>
        <span className={`${DAY_CELL} flex items-center gap-2`}>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-4 shrink-0 text-text-muted group-open:rotate-90"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 3 5 5-5 5" />
          </svg>
          {formatDay(day.date)}
        </span>
        {numbers}
      </summary>
      <div className={`flex flex-col gap-4 pb-4 ${DAY_INDENT}`}>
        {day.rides.length > 0 && <Cycling date={day.date} tss={day.cyclingTss} rides={day.rides} />}
        {day.strength !== null && <Strength strength={day.strength} />}
      </div>
    </details>
  );
}

function SectionHeading({ title, tss }: { readonly title: string; readonly tss: number }) {
  return (
    <h3 className="flex items-baseline justify-between gap-2 text-14 font-semibold">
      <span>{title}</span>
      <span className="tabular-nums">{formatLoad(tss)} TSS</span>
    </h3>
  );
}

type CyclingProps = {
  readonly date: string;
  readonly tss: number;
  readonly rides: readonly RideDetail[];
};

function Cycling({ date, tss, rides }: CyclingProps) {
  return (
    <div className="flex flex-col gap-1">
      <SectionHeading title="Cycling" tss={tss} />
      <ul className="flex flex-col">
        {rides.map((ride) => (
          <li key={ride.id} className="flex flex-col gap-1 border-t border-border py-2 first:border-t-0">
            <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-14">
              <span className="font-semibold">{ride.name ?? "Untitled ride"}</span>
              <span className="text-12 text-text-muted">
                Started <time dateTime={`${date}T${ride.startTime}`}>{ride.startTime}</time>
              </span>
            </p>
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-14 tabular-nums">
              <Metric
                term="Moving time"
                value={ride.movingTimeS === null ? null : `${formatDuration(ride.movingTimeS)} h`}
              />
              <Metric term="NP" value={ride.np === null ? null : formatWatts(ride.np)} />
              <Metric term="IF" value={ride.intensityPct === null ? null : formatIf(ride.intensityPct)} />
              <Metric term="TSS" value={ride.tss === null ? null : formatLoad(ride.tss)} />
              <Metric term="Source" value={formatDevice(ride.device)} />
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A term/value pair; a missing value is a dash that is spoken as "not recorded". */
function Metric({ term, value }: { readonly term: string; readonly value: string | null }) {
  return (
    <div className="flex gap-1">
      <dt className="text-text-muted">{term}</dt>
      <dd>
        {value ?? (
          <>
            <span aria-hidden="true">–</span>
            <span className="sr-only">not recorded</span>
          </>
        )}
      </dd>
    </div>
  );
}

/**
 * One section per strength activity of the day (spec today.md §8), by session number. A matched
 * activity names its sheet session and lists the exercises; an extra one is "not in the program".
 */
function Strength({ strength }: { readonly strength: StrengthDetail }) {
  const anyExercises = strength.sessions.some((s) => s.exercises.length > 0);
  return (
    <div className="flex flex-col gap-4">
      {strength.sessions.map((s) => (
        <StrengthSession key={s.key} session={s} />
      ))}
      {anyExercises && (
        <p className="text-12 text-text-muted">
          Score/set is the raw score of one set, before the strength factor that turns it into TSS.
        </p>
      )}
    </div>
  );
}

function StrengthSession({ session: s }: { readonly session: SessionDetail }) {
  const title =
    s.block === null
      ? "Strength · not in the program"
      : `Session ${s.session} · ${s.block}${s.week === null ? "" : ` · week ${s.week}`}`;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-16 font-semibold">{title}</h3>
      <p className="text-14 text-text-muted">
        {hasActivityWords(s.activityName, s.movingTimeS) && (
          <>
            <ActivityWords name={s.activityName} movingTimeS={s.movingTimeS} />
            {" · "}
          </>
        )}
        <span className="tabular-nums">{formatLoad(s.tss)} TSS</span>
      </p>
      {s.exercises.length > 0 && (
        <ol aria-label="Exercises" className="flex flex-col">
          {s.exercises.map((exercise) => (
            <Exercise key={exercise.key} exercise={exercise} />
          ))}
        </ol>
      )}
    </div>
  );
}

function Exercise({ exercise: e }: { readonly exercise: ExerciseDetail }) {
  const load = formatSetLoad(e.loggedKg, e.bodyweight);
  const score = formatScore(e.scorePerSet);
  return (
    <li className="flex flex-col border-t border-border py-2 first:border-t-0">
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-14">
        <span className="font-semibold">{e.name}</span>
        {e.prescribed !== null && (
          <span className="text-12 text-text-muted">Prescribed {e.prescribed}</span>
        )}
      </p>
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-14 tabular-nums">
        <span>
          <span aria-hidden="true">
            {e.sets} × {e.reps}
            {load !== null && ` × ${load}`}
          </span>
          <span className="sr-only">
            {e.sets} {e.sets === 1 ? "set" : "sets"} of {e.reps} reps{load !== null && ` at ${load}`}
          </span>
          {load === null && (
            <span className="text-text-muted">
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, </span>
              no kg logged
            </span>
          )}
        </span>
        <span className="text-12 text-text-muted">
          <span aria-hidden="true">{score} score/set</span>
          <span className="sr-only">raw score {score} per set</span>
        </span>
      </p>
    </li>
  );
}

/** Skeleton in the shape of WeekDays: column heads, `rows` day rows, the total row. */
export function WeekDaysSkeleton({ rows }: { readonly rows: number }) {
  const numbers = ["cycling", "strength", "total"].map((key) => (
    <span key={key} className="flex justify-end">
      <SkeletonBar className="w-1/2 text-14" />
    </span>
  ));
  return (
    <div aria-hidden="true" className="@container flex flex-col">
      <div className={`${ROW} border-b border-border py-2 text-12`}>
        <span className={`hidden @xs:block ${DAY_INDENT}`}>
          <SkeletonBar className="w-1/3" />
        </span>
        {["cycling", "strength", "total"].map((key) => (
          <span key={key} className="flex flex-col items-end">
            <SkeletonBar className="w-3/4" />
            <SkeletonBar className="w-1/2" />
          </span>
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`${ROW} min-h-11 items-center border-b border-border py-2 text-14`}>
          <span className={`${DAY_CELL} ${DAY_INDENT}`}>
            <SkeletonBar className="w-2/3" />
          </span>
          {numbers}
        </div>
      ))}
      <div className={`${ROW} items-center pt-2 text-14`}>
        <span className={DAY_CELL}>
          <SkeletonBar className="w-3/4" />
        </span>
        {numbers}
      </div>
    </div>
  );
}
