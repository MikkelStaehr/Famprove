import type { ReactNode } from "react";

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
  formatDateRange,
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
import { weekdayLabel } from "@/lib/training-view";
import { type DatedPlan, planLabel, type PlannedSession } from "@/lib/week-plan";

import { Card } from "./Card";
import { Icon } from "./icons";
import { MonoCaption } from "./MonoCaption";
import { ActivityWords, hasActivityWords } from "./MovingTime";
import { SkeletonBar } from "./Skeleton";
import { DiamondIcon } from "./WarningLine";

/**
 * The one week card (review-round.md §7), on /load (`full`) and Træning (`compact`): header
 * `Uge 42` + the date range, one ListRow-shaped row per daily_load day (day | icon | text | TSS),
 * the current week's strength plan from lib/week-plan.ts (today's session on today's row with
 * I DAG, undated ones last with "–"), then `I alt` (done / ~planned from weekly_plan, §1).
 * `full`: day rows open native <details> with the rides and sets (keyboard and screen reader
 * without JS), and `footer` holds the switcher. `compact`: plain 36px rows, single line, no details,
 * no switcher. Displays values only; every number comes from Python or SQL.
 */
export type WeekCardVariant = "full" | "compact";

/** What the card body shows: the rows, a skeleton while they stream, or a message (error / empty). */
export type WeekBody =
  | {
      readonly kind: "rows";
      /** The week's weekly_load row (with weekly_plan's done / planned); null: no row yet (I alt "–"). */
      readonly week: WeekView | null;
      readonly days: readonly DayDetail[];
      /** The strength log's first day (earliest block start): days before it read "styrke ikke registreret". */
      readonly logStart: IsoDate | null;
      readonly today: IsoDate;
      /** The current week's plan (lib/week-plan.ts datedPlan); null for other weeks or when unread. */
      readonly plan: DatedPlan | null;
    }
  | { readonly kind: "loading"; readonly rows: number }
  | { readonly kind: "message"; readonly node: ReactNode };

type WeekCardProps = {
  readonly variant: WeekCardVariant;
  /** The ISO week in the header. */
  readonly head: { readonly isoWeek: number; readonly weekStart: IsoDate; readonly weekEnd: IsoDate } | null;
  readonly body: WeekBody;
  /** sr-only text after the header (Træning: the sessions' state, weekSentence). */
  readonly sentence?: ReactNode;
  /** full: the week switcher. */
  readonly footer?: ReactNode;
  readonly className?: string;
};

export function WeekCard({ variant, head, body, sentence, footer, className }: WeekCardProps) {
  return (
    <Card
      id="week"
      title={head === null ? "Denne uge" : `Uge ${head.isoWeek}`}
      action={head === null ? undefined : <MonoCaption uppercase={false}>{formatDateRange(head.weekStart, head.weekEnd)}</MonoCaption>}
      className={`gap-1${className === undefined ? "" : ` ${className}`}`}
    >
      {sentence}
      {body.kind === "rows" ? (
        <WeekRows variant={variant} {...body} />
      ) : body.kind === "loading" ? (
        <WeekRowsSkeleton variant={variant} rows={body.rows} />
      ) : (
        body.node
      )}
      {footer !== undefined && <div className="mt-3">{footer}</div>}
    </Card>
  );
}

const SHORT_DAY: readonly string[] = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
/** full: 44px rows (each opens its details); compact: 36px, not interactive (§7: padding 7px 0). */
const ROW: Record<WeekCardVariant, string> = {
  full: "flex min-h-11 items-center gap-3 border-t border-border py-2.5",
  compact: "flex min-h-9 items-center gap-3 border-t border-border py-[7px]",
};
const DAY_COL = "w-9 shrink-0 font-mono text-12";
const VALUE = "shrink-0 text-right font-mono text-14 text-text tabular-nums";

function WeekRows({
  variant,
  week,
  days,
  logStart,
  today,
  plan,
}: Omit<Extract<WeekBody, { kind: "rows" }>, "kind"> & { readonly variant: WeekCardVariant }) {
  const row = ROW[variant];
  return (
    <div className="flex flex-col">
      {(days.length > 0 || (plan?.undated.length ?? 0) > 0) && (
        <ul aria-label={week === null ? "Dage i denne uge" : `Dage i uge ${week.isoWeek}`} className="flex flex-col">
          {days.map((day) => (
            <li key={day.date}>
              <DayRow
                variant={variant}
                day={day}
                short={SHORT_DAY[(new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7] ?? formatDay(day.date)}
                beforeLog={logStart === null || day.date < logStart}
                today={day.date === today}
                planned={day.date === today ? (plan?.today ?? null) : null}
              />
            </li>
          ))}
          {plan?.undated.map((p) => (
            <li key={`plan-${p.session}`}>
              <PlanRow row={row} plan={p} today={today} />
            </li>
          ))}
        </ul>
      )}
      <p className={row}>
        <span className={DAY_COL} />
        <span className="min-w-0 flex-1 font-sans text-14 font-medium text-text">I alt</span>
        <WeekTotal week={week} logStart={logStart} />
      </p>
    </div>
  );
}

/**
 * §1: the current week with a planned value reads `72 / ~257` (done 500 --text, ` / ~257` muted;
 * spoken "72 TSS udført af cirka 257 planlagt"); every other week the done figure only. Never "/ ~0".
 */
function WeekTotal({ week, logStart }: { readonly week: WeekView | null; readonly logStart: IsoDate | null }) {
  if (week === null) {
    return (
      <span className={VALUE}>
        <span aria-hidden="true">–</span>
        <span className="sr-only">ingen ugetotal endnu</span>
      </span>
    );
  }
  const split = `uge ${week.isoWeek}: cykling ${formatLoad(week.cyclingTss)} TSS, styrke ${strengthSr(week, logStart)}, i alt `;
  if (week.plan === null) {
    return (
      <span className={`${VALUE} font-medium`}>
        <span className="sr-only">{split}</span>
        {formatLoad(week.totalTss)}
        <span className="sr-only"> TSS</span>
      </span>
    );
  }
  const done = formatLoad(week.plan.doneTss);
  const planned = formatLoad(week.plan.plannedTss);
  return (
    <span className={VALUE}>
      <span className="sr-only">
        {split}
        {done} TSS udført af cirka {planned} planlagt
      </span>
      <span aria-hidden="true">
        <span className="font-medium text-text">{done}</span>
        <span className="font-normal text-text-muted"> / ~{planned}</span>
      </span>
    </span>
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

/**
 * A planned session without a day row: "–" (spoken "uden dato") | barbell muted | "Styrke · session 3"
 * muted | "plan" (review-round.md §1). The current one (today has no daily_load row yet) shows
 * today's day and I DAG.
 */
function PlanRow({ row, plan, today }: { readonly row: string; readonly plan: PlannedSession; readonly today: IsoDate }) {
  const current = plan.kind === "current";
  return (
    <div className={row}>
      {current ? (
        <time dateTime={today} className={`${DAY_COL} font-medium text-text`}>
          {weekdayLabel(today)}
        </time>
      ) : (
        <span className={`${DAY_COL} text-text-muted`}>
          <span aria-hidden="true">–</span>
          <span className="sr-only">uden dato</span>
        </span>
      )}
      <Icon name="barbell" size={18} className={current ? "text-text" : "text-text-muted"} />
      <span className={`min-w-0 flex-1 truncate font-sans text-14 ${current ? "text-text" : "text-text-muted"}`}>{planLabel(plan.session)}</span>
      {current ? (
        <span className="shrink-0 font-mono text-11 text-today uppercase">I dag</span>
      ) : (
        <span className="shrink-0 font-mono text-12 text-text-muted">plan</span>
      )}
    </div>
  );
}

function DayRow({
  variant,
  day,
  short,
  beforeLog,
  today,
  planned,
}: {
  readonly variant: WeekCardVariant;
  readonly day: DayDetail;
  readonly short: string;
  readonly beforeLog: boolean;
  readonly today: boolean;
  /** Today's planned session (not done yet), from lib/week-plan.ts. */
  readonly planned: PlannedSession | null;
}) {
  const strength = strengthWords(day);
  const ride = day.rides.length > 0;
  const plan = planned === null ? null : planLabel(planned.session);
  const text = [ride ? rideNames(day) : null, strength, plan].filter((t): t is string => t !== null).join(" · ");
  const muted = day.rest && plan === null;
  const label = muted ? (beforeLog ? "Ingen cykling · styrke ikke registreret" : "Hvile") : text;
  const loaded = formatLoad(day.totalTss) !== "0";
  const spoken = `${formatDay(day.date)}: cykling ${formatLoad(day.cyclingTss)} TSS, styrke ${beforeLog ? "ikke registreret" : `${formatLoad(day.strengthTss)} TSS`}, i alt ${formatLoad(day.totalTss)} TSS${plan === null ? "" : `, planlagt ${plan.toLowerCase()}`}`;
  const inner = (
    <>
      <span aria-hidden="true" className={`${DAY_COL} ${today ? "font-medium text-text" : "text-text-muted"}`}>
        {short}
      </span>
      <span aria-hidden="true" className="flex shrink-0 items-center gap-1 empty:hidden">
        {ride && <Icon name="bike" size={18} className="text-text" />}
        {(strength !== null || plan !== null) && <Icon name="barbell" size={18} className="text-text" />}
      </span>
      <span aria-hidden="true" className={`min-w-0 flex-1 font-sans text-14 ${variant === "compact" ? "truncate " : ""}${muted ? "text-text-muted" : "text-text"}`}>
        {label}
      </span>
      <span aria-hidden="true" className="flex shrink-0 items-center gap-2">
        {today && <span className="font-mono text-11 text-today">I DAG</span>}
        {(loaded || !day.rest) && <span className={VALUE}>{formatLoad(day.totalTss)}</span>}
      </span>
      <span className="sr-only">{spoken}</span>
    </>
  );
  if (day.rest || variant === "compact") return <div className={ROW[variant]}>{inner}</div>;
  return (
    <details className="group">
      <summary className={`${ROW.full} cursor-pointer list-none`}>{inner}</summary>
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

/** Skeleton in the shape of the rows: `rows` day rows and the total row. */
function WeekRowsSkeleton({ variant, rows }: { readonly variant: WeekCardVariant; readonly rows: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col">
      {Array.from({ length: rows + 1 }, (_, i) => (
        <div key={i} className={ROW[variant]}>
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
