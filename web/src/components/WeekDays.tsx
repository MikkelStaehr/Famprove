import type {
  DayDetail,
  ExerciseDetail,
  RideDetail,
  SessionDetail,
  StrengthDetail,
  WeekView,
} from "@/lib/dashboard-view";
import type { IsoDate } from "@/lib/db/rows";
import {
  formatDay,
  formatDevice,
  formatDuration,
  formatIf,
  formatKg,
  formatLoad,
  formatScore,
  formatSetLoad,
  formatVi,
  formatWatts,
} from "@/lib/format";

import { Icon } from "./icons";
import { ActivityWords, hasActivityWords } from "./MovingTime";
import { SkeletonBar } from "./Skeleton";
import { DiamondIcon } from "./WarningLine";

/**
 * The selected week's days (reset-belastning.md §6, mockup A): one ListRow-shaped row per day, day |
 * icon | text | value, behind native <details>/<summary> (keyboard and screen reader without JS),
 * then the `I alt` row from weekly_load. Displays values only; every number comes from Python or SQL.
 */
const SHORT_DAY: readonly string[] = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
const ROW = "flex min-h-11 items-center gap-3 border-t border-border py-2.5";
const DAY_COL = "w-9 shrink-0 font-mono text-12";
const VALUE = "shrink-0 text-right font-mono text-14 text-text tabular-nums";

type WeekDaysProps = {
  readonly week: WeekView;
  readonly days: readonly DayDetail[];
  /** The strength log's first day (earliest block start): days before it read "styrke ikke registreret". */
  readonly logStart: IsoDate | null;
  readonly today: IsoDate;
};

export function WeekDays({ week, days, logStart, today }: WeekDaysProps) {
  return (
    <div className="flex flex-col">
      <ul aria-label={`Dage i uge ${week.isoWeek}`} className="flex flex-col">
        {days.map((day, i) => (
          <li key={day.date}>
            <DayRow day={day} short={SHORT_DAY[i] ?? formatDay(day.date)} beforeLog={logStart === null || day.date < logStart} today={day.date === today} />
          </li>
        ))}
      </ul>
      <p className={ROW}>
        <span className={DAY_COL} />
        <span className="min-w-0 flex-1 font-sans text-14 font-medium text-text">I alt</span>
        <span className={`${VALUE} font-medium`}>
          <span className="sr-only">uge {week.isoWeek}: cykling {formatLoad(week.cyclingTss)} TSS, styrke {strengthSr(week, logStart)}, i alt </span>
          {formatLoad(week.totalTss)}
          <span className="sr-only"> TSS</span>
        </span>
      </p>
    </div>
  );
}

/** Strength before the log is missing, never 0 (CLAUDE.md): a week wholly before it says so, a week across it is partial. */
function strengthSr(week: WeekView, logStart: IsoDate | null): string {
  if (logStart === null || week.weekEnd < logStart) return "ikke registreret";
  const tss = `${formatLoad(week.strengthTss)} TSS`;
  return week.weekStart < logStart ? `${tss}, delvist registreret` : tss;
}

function rideNames(day: DayDetail): string {
  return day.rides.map((r) => r.name ?? "Tur uden navn").join(" · ");
}

function strengthWords(day: DayDetail): string | null {
  if (day.strength === null) return null;
  return day.strength.sessions.map((s) => (s.block === null ? "Styrke · ikke i programmet" : `Styrke · session ${s.session}`)).join(" · ");
}

function DayRow({ day, short, beforeLog, today }: { readonly day: DayDetail; readonly short: string; readonly beforeLog: boolean; readonly today: boolean }) {
  const strength = strengthWords(day);
  const ride = day.rides.length > 0;
  const text = [ride ? rideNames(day) : null, strength].filter((t): t is string => t !== null).join(" · ");
  const muted = day.rest;
  const label = day.rest ? (beforeLog ? "Ingen cykling · styrke ikke registreret" : "Hvile") : text;
  const loaded = formatLoad(day.totalTss) !== "0";
  const spoken = `${formatDay(day.date)}: cykling ${formatLoad(day.cyclingTss)} TSS, styrke ${beforeLog ? "ikke registreret" : `${formatLoad(day.strengthTss)} TSS`}, i alt ${formatLoad(day.totalTss)} TSS`;
  const inner = (
    <>
      <span aria-hidden="true" className={`${DAY_COL} ${today ? "font-medium text-text" : "text-text-muted"}`}>
        {short}
      </span>
      <span aria-hidden="true" className="flex shrink-0 items-center gap-1 empty:hidden">
        {ride && <Icon name="bike" size={18} className="text-text" />}
        {strength !== null && <Icon name="barbell" size={18} className="text-text" />}
      </span>
      <span aria-hidden="true" className={`min-w-0 flex-1 font-sans text-14 ${muted ? "text-text-muted" : "text-text"}`}>
        {label}
      </span>
      <span aria-hidden="true" className="flex shrink-0 items-center gap-2">
        {today && <span className="font-mono text-11 text-today">I DAG</span>}
        {(loaded || !day.rest) && <span className={VALUE}>{formatLoad(day.totalTss)}</span>}
      </span>
      <span className="sr-only">{spoken}</span>
    </>
  );
  if (day.rest) return <div className={ROW}>{inner}</div>;
  return (
    <details className="group">
      <summary className={`${ROW} cursor-pointer list-none`}>{inner}</summary>
      <div className="flex flex-col gap-4 pt-2 pb-3 pl-12">
        {day.rides.length > 0 && <Cycling date={day.date} tss={day.cyclingTss} rides={day.rides} />}
        {day.strength !== null && <Strength strength={day.strength} />}
      </div>
    </details>
  );
}

function SectionHeading({ title, tss }: { readonly title: string; readonly tss: number }) {
  return (
    <h3 className="flex items-baseline justify-between gap-2 text-13 font-medium">
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
      <SectionHeading title="Cykel" tss={tss} />
      <ul className="flex flex-col">
        {rides.map((ride) => (
          <li key={ride.id} className="flex flex-col gap-1 border-t border-border py-2 first:border-t-0">
            <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-13">
              <span className="font-medium">{ride.name ?? "Tur uden navn"}</span>
              <span className="text-13 text-text-muted">
                Start kl. <time dateTime={`${date}T${ride.startTime}`}>{ride.startTime.replace(":", ".")}</time>
              </span>
            </p>
            {ride.dataWarning !== null && <DataWarning warning={ride.dataWarning} />}
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-13 tabular-nums">
              <Metric
                term="Bevægelsestid"
                value={ride.movingTimeS === null ? null : `${formatDuration(ride.movingTimeS)} t`}
              />
              <Metric term="NP" value={ride.np === null ? null : formatWatts(ride.np)} />
              <Metric term="IF" value={ride.intensityPct === null ? null : formatIf(ride.intensityPct)} />
              <ViMetric vi={ride.vi} warning={ride.viWarning} />
              <Metric term="TSS" value={ride.tss === null ? null : formatLoad(ride.tss)} />
              <Metric term="Kilde" value={formatDevice(ride.device)} />
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Python flagged the ride's power data (spike rules, domain.power_check): a ◆ and words
 * (Revision 5 [A1], never colour alone). Tapping it shows which rule fired (a tooltip doesn't show
 * on a phone); the title gives the same text on hover.
 */
function DataWarning({ warning }: { readonly warning: string }) {
  return (
    // Named group: this <details> sits inside a day row's (also a group), which is always open here.
    <details className="group/data text-13">
      <summary
        title={warning}
        className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium text-warning"
      >
        <DiamondIcon />
        Tjek effektdata
        {/* The day rows' 16px chevron, pointing down; it flips without transition when open. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-4 shrink-0 text-text-muted group-open/data:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m3 6 5 5 5-5" />
        </svg>
      </summary>
      <p className="mt-1 max-w-[60ch] text-text-muted">{warning}</p>
    </details>
  );
}

/** A term/value pair; a missing value is a dash that is spoken as "ikke registreret". */
function Metric({ term, value }: { readonly term: string; readonly value: string | null }) {
  return (
    <div className="flex gap-1">
      <dt className="text-text-muted">{term}</dt>
      <dd>
        {value ?? (
          <>
            <span aria-hidden="true">–</span>
            <span className="sr-only">ikke registreret</span>
          </>
        )}
      </dd>
    </div>
  );
}

/**
 * VI (Python: NP / average power) next to NP and IF. The term carries the explanation as a
 * tooltip. A warning (Python: VI > 1.15 on a Z2 day) is --warning with a ◆ and words for
 * screen readers, never colour alone. A ride without VI shows nothing (an HR-only ride has no NP).
 */
function ViMetric({ vi, warning }: { readonly vi: number | null; readonly warning: boolean }) {
  if (vi === null) return null;
  return (
    <div className="flex gap-1">
      <dt className="text-text-muted">
        <abbr title="Jævnhed – 1.0 = konstant effekt" className="no-underline">
          VI
        </abbr>
      </dt>
      <dd className={warning ? "flex items-center gap-1 text-warning" : undefined}>
        {warning && <DiamondIcon />}
        {formatVi(vi)}
        {warning && <span className="sr-only">, ujævn effekt på en Z2-dag</span>}
      </dd>
    </div>
  );
}

/**
 * One section per strength activity of the day (spec today.md §8), by session number. A matched
 * activity names its sheet session and lists the exercises; an extra one is "ikke i programmet".
 */
function Strength({ strength }: { readonly strength: StrengthDetail }) {
  const anyExercises = strength.sessions.some((s) => s.exercises.length > 0);
  return (
    <div className="flex flex-col gap-4">
      {strength.sessions.map((s) => (
        <StrengthSession key={s.key} session={s} />
      ))}
      {anyExercises && (
        <p className="text-13 text-text-muted">
          Score pr. sæt er den rå score for ét sæt, før styrkefaktoren gør den til TSS.
        </p>
      )}
    </div>
  );
}

function StrengthSession({ session: s }: { readonly session: SessionDetail }) {
  const title =
    s.block === null
      ? "Styrke · ikke i programmet"
      : `Session ${s.session} · ${s.block}${s.week === null ? "" : ` · uge ${s.week}`}`;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-14 font-medium">{title}</h3>
      <p className="text-13 text-text-muted">
        {hasActivityWords(s.activityName, s.movingTimeS) && (
          <>
            <ActivityWords name={s.activityName} movingTimeS={s.movingTimeS} />
            {" · "}
          </>
        )}
        <span className="tabular-nums">{formatLoad(s.tss)} TSS</span>
      </p>
      {s.exercises.length > 0 && (
        <ol aria-label="Øvelser" className="flex flex-col">
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
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-13">
        <span className="font-medium">{e.name}</span>
        {e.prescribed !== null && (
          <span className="text-13 text-text-muted">Foreskrevet {e.prescribed}</span>
        )}
      </p>
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-13 tabular-nums">
        <span>
          <span aria-hidden="true">
            {e.sets} × {e.reps}
            {load !== null && ` × ${load}`}
          </span>
          <span className="sr-only">
            {e.sets} sæt af {e.reps} reps{load !== null && ` med ${load}`}
          </span>
          {e.effectiveKg !== null && (
            <span className="text-text-muted">
              <span aria-hidden="true"> · {formatKg(e.effectiveKg)} kg effektivt</span>
              <span className="sr-only">, effektivt {formatKg(e.effectiveKg)} kg</span>
            </span>
          )}
          {load === null && (
            <span className="text-text-muted">
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, </span>
              intet kg logget
            </span>
          )}
        </span>
        <span className="text-13 text-text-muted">
          <span aria-hidden="true">{score} score/sæt</span>
          <span className="sr-only">rå score {score} pr. sæt</span>
        </span>
      </p>
    </li>
  );
}

/** Skeleton in the shape of WeekDays: `rows` day rows and the total row. */
export function WeekDaysSkeleton({ rows }: { readonly rows: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col">
      {Array.from({ length: rows + 1 }, (_, i) => (
        <div key={i} className={ROW}>
          <span className={DAY_COL}>
            <SkeletonBar className="w-2/3 text-12" />
          </span>
          <SkeletonBar className="w-1/2 flex-1 text-14" />
          <SkeletonBar className="w-6 text-14" />
        </div>
      ))}
    </div>
  );
}
