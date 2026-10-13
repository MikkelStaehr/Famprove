"use client";

import { type RefObject, useEffect, useId, useRef, useState } from "react";

import {
  FEEL_OPTIONS,
  feelQuestion,
  footerText,
  type FokusExercise,
  nextFeel,
  nextSetSummary,
  NOTE_CLAMP_CHARS,
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

import { ArrowIcon, INK_LINK, PRIMARY_BOX, PRIMARY_DOCK } from "./Instrument";
import { RestTimer, useElapsed } from "./RestTimer";

type PrimaryRef = RefObject<(HTMLButtonElement & HTMLAnchorElement) | null>;

export function PrimaryButton({ primary, onClick, children }: { readonly primary: PrimaryRef; readonly onClick: () => void; readonly children: string }) {
  return (
    <div className={`mt-10 ${PRIMARY_DOCK}`}>
      <button ref={primary} type="button" onClick={onClick} className={PRIMARY_BOX}>
        {children}
        <ArrowIcon />
      </button>
    </div>
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
      <h2 id={`${id}-q`} className="font-grotesk text-20 font-normal">
        {feelQuestion(set, named)}
      </h2>
      {/* Round 4: one segmented control, a 1px --text-muted box, --border hairlines inside only. */}
      <div role="group" aria-labelledby={`${id}-q`} className="mt-3 grid grid-cols-3 border border-text-muted">
        {FEEL_OPTIONS.map((o) => {
          const on = felt === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              aria-label={o.label}
              onClick={() => onTap("feel", set.ref, nextFeel(felt, o.value))}
              className={`relative flex min-h-14 items-center justify-center px-2 font-grotesk text-16 leading-tight font-medium not-first:border-l not-first:border-border focus-visible:z-10 focus-visible:outline-offset-2 ${
                on ? "bg-text text-bg" : "text-text"
              }`}
            >
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
    "flex size-14 items-center justify-center border border-text-muted text-text disabled:border-dashed disabled:text-text-muted";
  return (
    <div role="group" aria-labelledby={`${id}-l`} className="mt-3 flex items-center justify-between gap-3">
      <p id={`${id}-l`} className="flex flex-col">
        <span className="font-grotesk text-16">Reps i sæt {set.number}</span>
        {/* A small tabular number, not a caption label: mono in the muted grey (Barley Corn is for captions only). */}
        <span className="font-mono text-14 text-text-muted">
          {low} - {top}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <button type="button" disabled={value <= min} aria-disabled={value <= min} onClick={() => change(-1)} className={stepButton}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M5 12h14" />
          </svg>
          <span className="sr-only">Færre reps</span>
        </button>
        <output aria-live="polite" className="min-w-[3ch] text-center font-grotesk text-32 font-normal tabular-nums">
          {value}
        </output>
        <button type="button" disabled={value >= max} aria-disabled={value >= max} onClick={() => change(1)} className={stepButton}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M5 12h14M12 5v14" />
          </svg>
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
    <section aria-label="Pause" className="mt-10 flex flex-col">
      <p className="caption">Pause</p>
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
          <span className="caption absolute top-0 -translate-x-1/2 leading-none" style={{ left: pct(f.minX + 1) }}>
            Min
          </span>
          <span className="caption absolute top-0 -translate-x-1/2 leading-none" style={{ left: pct(f.maxX + 0.5) }}>
            Max
          </span>
        </div>
      )}
      <svg viewBox="0 0 360 60" className="block h-auto w-full" data-scale-s={scaleS} data-filled={f.filled}>
        {f.dots.map((d, i) =>
          d.kind === "over" ? (
            <circle key={i} cx={d.cx} cy={d.cy} r={1.25} fill="none" stroke="var(--text)" strokeWidth={1} />
          ) : (
            <circle key={i} cx={d.cx} cy={d.cy} r={1.5} fill={d.kind === "filled" ? "var(--text)" : "var(--border)"} />
          ),
        )}
        {marks && f.minX !== null && f.maxX !== null && (
          <>
            <rect data-mark="min" x={f.minX} y={4} width={2} height={52} fill="var(--text)" />
            <rect data-mark="max" x={f.maxX} y={4} width={1} height={52} fill="var(--text)" />
          </>
        )}
        <rect data-now={f.tickX} x={f.tickX} y={0} width={2} height={60} fill="var(--accent)" />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-12 leading-none text-text-muted">
        <span>0</span>
        <span>{endMinutes(scaleS)}</span>
      </div>
    </div>
  );
}

/** The warm-up's scale: 0-10 minutes (round 2). */
const WARMUP_SCALE_S = 600;

/** §2: the warm-up of `exercise`, with Python's ramp on a main lift (fokus-instrument.md §3: a mono table). */
export function WarmupCard({ since, exercise, mainLift }: { readonly since: string | null; readonly exercise: FokusExercise; readonly mainLift: boolean }) {
  const ramp = rampState(exercise, mainLift);
  const basis = rampBasis(exercise);
  return (
    <section aria-labelledby="fokus-warmup" className="flex flex-col">
      <h2 id="fokus-warmup" className="font-grotesk text-32 font-normal [overflow-wrap:anywhere]">
        {warmupTitle(exercise)}
      </h2>
      <div className="mt-14">
        {/* No recorded start (§2.2): a static 0:00 with the tick at 0, never a clock from page load. */}
        {since === null ? <WarmupClock seconds={0} /> : <WarmupTimer since={since} />}
      </div>
      {ramp === "ramp" && exercise.ramp !== null && (
        <div className="@container mt-14 flex flex-col">
          {basis !== null && <p className="caption">{basis}</p>}
          {/* One row of columns while they fit (21rem at 100 % text); stacked at 200 % text. */}
          <ol aria-label="Opvarmningssæt" className="mt-3 grid gap-x-3 gap-y-4 @min-[21rem]:auto-cols-fr @min-[21rem]:grid-flow-col">
            {exercise.ramp.map((r) => (
              <li key={r.pct} className="flex flex-col @min-[21rem]:not-first:border-l @min-[21rem]:not-first:border-border @min-[21rem]:not-first:pl-3">
                <span className="caption">{Math.round(r.pct)}&nbsp;%</span>
                <span className="flex flex-wrap items-baseline">
                  <span className="text-24 text-text">{formatKg(r.kg)}</span>
                  <span className="text-14 text-text-muted">&nbsp;kg</span>
                </span>
                <span className="font-mono text-14 text-text-muted">{r.reps} reps</span>
                <span aria-hidden="true" className="relative mt-2 block h-px bg-text" style={{ width: `${Math.min(100, r.pct)}%` }}>
                  <span className="absolute right-0 bottom-0 block h-2 w-px bg-text" />
                </span>
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
 * "5 reps · RPE 7 · 142,5 kg", the kg's source (forslag / sidste uge) spoken, not shown.
 */
export function NextSetCard({
  next,
  inWarmup,
  afterTimer,
}: {
  readonly next: SetInContext;
  readonly inWarmup: boolean;
  /** Straight under the timer group (56px of air), else after another group (40px). */
  readonly afterTimer: boolean;
}) {
  const summary = nextSetSummary(next, inWarmup);
  const kg = summary.kg;
  return (
    <section aria-label="Næste sæt" className={`${afterTimer ? "mt-14" : "mt-10"} flex flex-col gap-1`}>
      <p className="font-grotesk text-20 [overflow-wrap:anywhere]">{summary.title}</p>
      {(summary.line !== "" || kg !== null) && (
        <p className="text-16 [overflow-wrap:anywhere]">
          {summary.line}
          {kg !== null && (
            <>
              {summary.line !== "" && " · "}
              <span className="sr-only">{kg.source} </span>
              {kg.text}
            </>
          )}
        </p>
      )}
    </section>
  );
}

/** The coach's note (round 3: in the set view, under the figures): a quiet muted line, long ones clamped. */
export function Note({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > NOTE_CLAMP_CHARS;
  return (
    <div className="flex flex-col items-start">
      <p className={`font-grotesk text-16 text-text-muted [overflow-wrap:anywhere] ${long && !open ? "line-clamp-3" : ""}`}>Note: {text}</p>
      {long && !open && (
        <button type="button" onClick={() => setOpen(true)} className={`-my-2.5 ${INK_LINK}`}>
          Hele noten
        </button>
      )}
    </div>
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
