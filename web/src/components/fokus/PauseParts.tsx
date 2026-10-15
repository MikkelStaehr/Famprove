"use client";

import { type RefObject, useEffect, useId, useRef, useState } from "react";

import {
  exerciseUnder,
  FEEL_OPTIONS,
  feelQuestion,
  footerText,
  type FokusExercise,
  nextFeel,
  nextSetSummary,
  rampBasis,
  rampState,
  repsRange,
  restBand,
  restSentence,
  type SetInContext,
  stepperBounds,
  stepperValue,
  warmupTitle,
} from "@/lib/fokus-view";
import type { LoggedSet, SetRef } from "@/lib/set-taps";
import { formatKg } from "@/lib/format";
import { dotField, FIELD_WIDTH } from "@/lib/fokus-marks";

import { Icon } from "@/components/icons";

import { ArrowIcon, CAPTION, PRIMARY_BOX, PRIMARY_DOCK } from "./Instrument";
import { RestTimer, useElapsed } from "./RestTimer";

type PrimaryRef = RefObject<(HTMLButtonElement & HTMLAnchorElement) | null>;

/** reset-fokus.md §3: the pause and warm-up surfaces are Cards (radius 22, padding 20). */
const CARD = "flex flex-col rounded-card border border-border bg-card p-5";

export function PrimaryButton({ primary, onClick, children }: { readonly primary: PrimaryRef; readonly onClick: () => void; readonly children: string }) {
  return (
    <>
      {/* Takes the free height of a short view, so the button sits at the bottom edge (user, 2026-10-13). */}
      <div aria-hidden="true" className="flex-1" />
      <div className={`mt-10 ${PRIMARY_DOCK}`}>
        <button ref={primary} type="button" onClick={onClick} className={PRIMARY_BOX}>
          {children}
          <ArrowIcon />
        </button>
      </div>
    </>
  );
}

/**
 * §1.1: how the set felt (Lettere / Som ventet / Hårdere) and, on a range set, the reps done.
 * Corrected in place (Fortryd never walks these). The reps default is the range top, which the
 * server already stored at Udført; the stepper shows the log's value and sends `reps` (600 ms
 * debounce, last value wins).
 */
export function FeelBlock({
  set,
  logged,
  named,
  onTap,
}: {
  readonly set: SetInContext;
  readonly logged: LoggedSet | undefined;
  readonly named: boolean;
  readonly onTap: (kind: "feel" | "reps", ref: SetRef, value: number | null) => void;
}) {
  const id = useId();
  const range = repsRange(set.exercise.repsText);
  const felt = logged?.feltRpe ?? null;
  return (
    <section aria-labelledby={`${id}-q`} className="mt-2 flex flex-col">
      <h2 id={`${id}-q`} className="font-sans text-20 font-medium">
        {feelQuestion(set, named)}
      </h2>
      {/* reset-fokus.md §4: the SegmentedControl look with 56px segments; the chosen one has the
          --raised fill and a check icon, so the choice is never carried by fill alone. */}
      <div
        role="group"
        aria-labelledby={`${id}-q`}
        className="mt-3 grid grid-cols-3 gap-0.5 rounded-control border border-text-muted bg-bg p-0.75"
      >
        {FEEL_OPTIONS.map((o) => {
          const on = felt === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              aria-label={o.label}
              onClick={() => onTap("feel", set.ref, nextFeel(felt, o.value))}
              className={`relative flex min-h-14 items-center justify-center gap-1 rounded-segment px-1 font-sans text-15 leading-tight font-medium text-text transition-colors duration-[120ms] ease-out focus-visible:z-10 ${
                on ? "bg-raised" : "bg-transparent"
              }`}
            >
              {on && <Icon name="check" size={16} />}
              {o.label}
            </button>
          );
        })}
      </div>
      {range !== null && (
        <RepsStepper set={set} top={range.top} low={range.low} logged={logged?.repsDone ?? null} onTap={onTap} />
      )}
    </section>
  );
}

function RepsStepper({
  set,
  low,
  top,
  logged,
  onTap,
}: {
  readonly set: SetInContext;
  readonly low: number;
  readonly top: number;
  readonly logged: number | null;
  readonly onTap: (kind: "reps", ref: SetRef, value: number) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(() => stepperValue(logged, top));
  const timer = useRef<number | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const { min, max } = stepperBounds(top);
  // Leaving the pause inside the debounce sends the last value at once (never dropped).
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      pending.current?.();
    },
    [],
  );
  const change = (delta: number) => {
    const v = Math.min(max, Math.max(min, value + delta));
    setValue(v);
    if (timer.current !== null) window.clearTimeout(timer.current);
    pending.current = () => {
      pending.current = null;
      onTap("reps", set.ref, v);
    };
    timer.current = window.setTimeout(() => pending.current?.(), 600);
  };
  const stepButton =
    "flex size-14 items-center justify-center rounded-button border border-text-muted bg-card text-text active:opacity-85 disabled:border-dashed disabled:text-text-muted";
  return (
    <div role="group" aria-labelledby={`${id}-l`} className="mt-3 flex items-center justify-between gap-3">
      <p id={`${id}-l`} className="flex flex-col">
        <span className="font-sans text-16">Reps i sæt {set.number}</span>
        {/* A small tabular number, not a caption label: mono in the muted grey (Barley Corn is for captions only). */}
        <span className="font-mono text-14 text-text-muted">
          {low}–{top}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <button type="button" disabled={value <= min} aria-disabled={value <= min} onClick={() => change(-1)} className={stepButton}>
          <Icon name="minus" size={22} />
          <span className="sr-only">Færre reps</span>
        </button>
        <output aria-live="polite" className="min-w-[3ch] text-center font-mono text-32 font-medium tabular-nums">
          {value}
        </output>
        <button type="button" disabled={value >= max} aria-disabled={value >= max} onClick={() => change(1)} className={stepButton}>
          <Icon name="plus" size={22} />
          <span className="sr-only">Flere reps</span>
        </button>
      </div>
    </div>
  );
}

/** §3: the pause between sets of one exercise; the scale's MIN and MAX carry the recommended rest (round 3). */
export function PauseCard({ since, exercise, onAnnounce }: { readonly since: string; readonly exercise: FokusExercise; readonly onAnnounce: (s: string) => void }) {
  const seconds = useElapsed(since);
  const band = restBand(seconds, exercise.restMinS, exercise.restMaxS);
  const said = useRef<string | null>(null);
  useEffect(() => {
    // Once at the minimum and once at the maximum, never the timer itself (§9).
    if (band.kind !== said.current && (band.kind === "ready" || band.kind === "over")) {
      const sentence = restSentence(band, exercise.restMinS, exercise.restMaxS);
      if (said.current !== null && sentence !== null) onAnnounce(sentence);
    }
    said.current = band.kind;
  }, [band, exercise.restMinS, exercise.restMaxS, onAnnounce]);
  // rest_min_s or rest_max_s null: no field (§3.1).
  const rail = exercise.restMinS !== null && exercise.restMaxS !== null;
  return (
    <section aria-label="Pause" className={`mt-10 ${CARD}`}>
      <p className={CAPTION}>Pause</p>
      <div className="mt-3">
        <RestTimer seconds={seconds} label="Pause" />
      </div>
      {rail && exercise.restMaxS !== null && (
        <Scale seconds={seconds} scaleS={1.2 * exercise.restMaxS} minS={exercise.restMinS} maxS={exercise.restMaxS} />
      )}
    </section>
  );
}

/** The scale's end value in minutes: 360 -> "6", 600 -> "10", 144 -> "2,4". */
function endMinutes(scaleS: number): string {
  return (Math.round((scaleS / 60) * 10) / 10).toString().replace(".", ",");
}

/** An x in viewBox units as a CSS left inside the 360-wide field. */
const pct = (x: number): string => `${(x / FIELD_WIDTH) * 100}%`;

/**
 * The dot field (fokus-round4.md §3.1): 60 × 6 dots filling column-major with elapsed time, MIN
 * (2 units) and MAX (1 unit) as taller ink marks, the red tick at the front. A drawing scale only
 * (lib/fokus-marks): it steps once a second with the timer, no transition or animation ever.
 */
function Scale({ seconds, scaleS, minS, maxS }: { readonly seconds: number; readonly scaleS: number; readonly minS: number | null; readonly maxS: number | null }) {
  const f = dotField(seconds, scaleS, minS, maxS);
  const marks = f.minX !== null && f.maxX !== null;
  return (
    <div aria-hidden="true" className="mt-3 flex w-full flex-col">
      {marks && f.minX !== null && f.maxX !== null && (
        <div className="relative h-4">
          <span className="absolute top-0 -translate-x-1/2 font-mono text-12 leading-none text-text-muted" style={{ left: pct(f.minX + 1) }}>
            Min
          </span>
          <span className="absolute top-0 -translate-x-1/2 font-mono text-12 leading-none text-text-muted" style={{ left: pct(f.maxX + 0.5) }}>
            Max
          </span>
        </div>
      )}
      <svg viewBox="0 0 360 60" className="block h-auto w-full" data-scale-s={scaleS} data-filled={f.filled}>
        {f.dots.map((d, i) =>
          d.kind === "over" ? (
            <circle key={i} cx={d.cx} cy={d.cy} r={1.25} fill="none" stroke="var(--text)" strokeWidth={1} />
          ) : (
            <circle key={i} cx={d.cx} cy={d.cy} r={1.5} fill={d.kind === "filled" ? "var(--text)" : emptyFill(d.cx, f.minX, f.maxX)} />
          ),
        )}
        {marks && f.minX !== null && f.maxX !== null && (
          <>
            <rect data-mark="min" x={f.minX} y={4} width={2} height={52} fill="var(--text)" />
            <rect data-mark="max" x={f.maxX} y={4} width={1} height={52} fill="var(--text)" />
          </>
        )}
        <rect data-now={f.tickX} x={f.tickX} y={0} width={2} height={60} fill="var(--text)" />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-12 leading-none text-text-muted">
        <span>0</span>
        <span>{endMinutes(scaleS)}</span>
      </div>
    </div>
  );
}

/**
 * An empty dot's colour (reset-fokus.md §5): inside the recommended rest (MIN..MAX) --shade-2, the
 * rest of the track --axis (on --card the --track value is near-invisible, 1.11:1). Decorative.
 */
function emptyFill(cx: number, minX: number | null, maxX: number | null): string {
  return minX !== null && maxX !== null && cx >= minX && cx <= maxX + 1 ? "var(--shade-2)" : "var(--axis)";
}

/** The warm-up's scale: 0-10 minutes (round 2). */
const WARMUP_SCALE_S = 600;

/** §2: the warm-up of `exercise`, with Python's ramp on a main lift (fokus-instrument.md §3: a mono table). */
export function WarmupCard({ since, exercise, mainLift }: { readonly since: string | null; readonly exercise: FokusExercise; readonly mainLift: boolean }) {
  const ramp = rampState(exercise, mainLift);
  const basis = rampBasis(exercise);
  const under = exerciseUnder(exercise);
  return (
    <section aria-labelledby="fokus-warmup" className={CARD}>
      <h2 id="fokus-warmup" className="font-sans text-32 font-semibold [overflow-wrap:anywhere] text-balance">
        {warmupTitle(exercise)}
      </h2>
      {/* variants.md §3: the sheet's exercise muted under "Opvarmning · <variant>". */}
      {under !== null && <p className="mt-1 font-sans text-14 text-balance text-text-muted">{under}</p>}
      <div className="mt-14">
        {/* No recorded start (§2.2): a static 0:00 with the tick at 0, never a clock from page load. */}
        {since === null ? <WarmupClock seconds={0} /> : <WarmupTimer since={since} />}
      </div>
      {ramp === "ramp" && exercise.ramp !== null && (
        <div className="mt-14 flex flex-col">
          {basis !== null && <p className={CAPTION}>{basis}</p>}
          {/* reset-fokus.md §5: ListRow-style rows (1px --border top, min 44px): % | kg | reps. */}
          <ol aria-label="Opvarmningssæt" className="mt-3 flex flex-col">
            {exercise.ramp.map((r) => (
              <li key={r.pct} className="flex min-h-11 flex-wrap items-center gap-x-3 border-t border-border py-2.5 font-mono tabular-nums">
                <span className="w-12 shrink-0 text-14 text-text-muted">{Math.round(r.pct)}&nbsp;%</span>
                <span className="flex flex-1 items-baseline">
                  <span className="text-24 font-medium text-text">{formatKg(r.kg)}</span>
                  <span className="text-14 text-text-muted">&nbsp;kg</span>
                </span>
                <span className="shrink-0 text-14 text-text-muted">{r.reps} reps</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {ramp === "none" && <p className="mt-14 text-16 text-text-muted">Intet kg at regne opvarmningen ud fra.</p>}
    </section>
  );
}

function WarmupTimer({ since }: { readonly since: string }) {
  return <WarmupClock seconds={useElapsed(since)} />;
}

function WarmupClock({ seconds }: { readonly seconds: number }) {
  return (
    <>
      <RestTimer seconds={seconds} label="Opvarmning" />
      <Scale seconds={seconds} scaleS={WARMUP_SCALE_S} minS={null} maxS={null} />
    </>
  );
}

/**
 * §1.2, round 3: the next set in two lines, nothing else. Line 1 "Squat · sæt 2 af 2"; line 2
 * "5 reps · RPE 7"; then today's kg under its caption and the Sidste uge item (fokus-kg.md §3).
 */
export function NextSetCard({
  next,
  week,
  inWarmup,
  afterTimer,
}: {
  readonly next: SetInContext;
  readonly week: number;
  readonly inWarmup: boolean;
  /** Straight under the timer group (56px of air), else after another group (40px). */
  readonly afterTimer: boolean;
}) {
  const summary = nextSetSummary(next, inWarmup, week);
  const kg = summary.kg;
  return (
    <section
      aria-label="Næste sæt"
      className={`${afterTimer ? "mt-14" : "mt-10"} flex flex-col gap-1 rounded-card border border-dashed border-shade-1 bg-card p-5`}
    >
      <p className="font-sans text-20 font-medium [overflow-wrap:anywhere] text-balance">{summary.title}</p>
      {/* variants.md §3: the sheet's exercise muted under the variant. */}
      {summary.exercise !== null && <p className="font-sans text-14 text-balance text-text-muted">{summary.exercise}</p>}
      {summary.line !== "" && <p className="text-16 [overflow-wrap:anywhere]">{summary.line}</p>}
      {/* fokus-kg.md §3: today's kg (caption + figure) and the Sidste uge item; visual copy aria-hidden. */}
      {(kg !== null || summary.lastWeek !== null) && (
        <div className="mt-2 flex min-w-0 flex-wrap gap-x-6 gap-y-1">
          {kg !== null && (
            <p className="flex min-w-0 flex-col gap-0.5">
              <span className="sr-only">{`${kg.spoken}.`}</span>
              <span aria-hidden="true" className="font-mono text-12 text-text-muted uppercase">
                {kg.caption}
              </span>
              <span aria-hidden="true" className={`font-mono text-16 tabular-nums${kg.italic ? " italic" : ""}`}>
                {kg.text}
              </span>
            </p>
          )}
          {summary.lastWeek?.kind === "kg" && (
            <p className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-12 text-text-muted uppercase">Sidste uge</span>
              <span className="font-mono text-16 tabular-nums">{summary.lastWeek.text}</span>
            </p>
          )}
          {summary.lastWeek?.kind === "new_variant" && <p className="min-w-0 self-end text-14 text-text-muted">{summary.lastWeek.text}</p>}
        </div>
      )}
    </section>
  );
}

/** §1.3: display timing from today's log, recomputed in the browser every 30 s (not data). */
export function Footer({ order, log }: { readonly order: readonly SetRef[]; readonly log: ReadonlyMap<string, LoggedSet> }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const text = footerText(order, log, now);
  if (text === null) return null;
  return (
    <p suppressHydrationWarning className="mt-3 font-mono text-14 text-text-muted">
      {text}
    </p>
  );
}
