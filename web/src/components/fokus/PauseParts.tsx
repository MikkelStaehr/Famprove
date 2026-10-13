"use client";

import { type RefObject, useEffect, useId, useRef, useState } from "react";

import {
  exerciseName,
  FEEL_OPTIONS,
  feelQuestion,
  footerText,
  type FokusExercise,
  lastWeekLine,
  nextFeel,
  nextSetSummary,
  NOTE_CLAMP_CHARS,
  rampBasis,
  rampState,
  repsRange,
  restBand,
  restLabel,
  restRail,
  restSentence,
  type SetInContext,
  stepperBounds,
  stepperValue,
  warmupTitle,
} from "@/lib/fokus-view";
import type { LoggedSet, SetRef } from "@/lib/set-taps";
import { formatKg } from "@/lib/format";

import { RestTimer, useElapsed } from "./RestTimer";

type PrimaryRef = RefObject<(HTMLButtonElement & HTMLAnchorElement) | null>;

const PRESS =
  "transition-transform duration-120 ease-out active:scale-97 motion-reduce:transition-none motion-reduce:active:scale-100";
export const PRIMARY_INK = `flex min-h-16 w-full items-center justify-center gap-2 rounded-pill bg-text px-4 font-display text-32 font-extrabold text-bg uppercase italic ${PRESS}`;
const IN_SLAB_FOCUS = "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-slab-mark";

function Check({ className }: { readonly className: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

export function PrimaryButton({ primary, onClick, children }: { readonly primary: PrimaryRef; readonly onClick: () => void; readonly children: string }) {
  return (
    <button ref={primary} type="button" onClick={onClick} className={`mt-4 ${PRIMARY_INK}`}>
      {children}
      <ArrowIcon />
    </button>
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
      <h2 id={`${id}-q`} className="text-20 font-bold">
        {feelQuestion(set, named)}
      </h2>
      <div role="group" aria-labelledby={`${id}-q`} className="mt-2 grid grid-cols-3 gap-2">
        {FEEL_OPTIONS.map((o) => {
          const on = felt === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onTap("feel", set.ref, nextFeel(felt, o.value))}
              className={`flex min-h-14 items-center justify-center gap-1 rounded-control px-1 text-16 leading-tight font-bold transition-colors duration-120 ease-out motion-reduce:transition-none ${
                on ? "border-2 border-slab bg-slab text-on-slab" : "border-2 border-text-muted text-text"
              }`}
            >
              {on && <Check className="size-4" />}
              <span>{o.label}</span>
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
  const stepButton = "flex size-14 items-center justify-center rounded-control border-2 text-24 font-bold disabled:border-border disabled:text-text-muted";
  return (
    <div role="group" aria-labelledby={`${id}-l`} className="mt-3 flex items-center justify-between gap-3">
      <p id={`${id}-l`} className="flex flex-col">
        <span className="text-16 font-semibold">Reps i sæt {set.number}</span>
        <span className="text-14 text-text-muted">
          {low} - {top}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <button type="button" disabled={value <= min} onClick={() => change(-1)} className={`${stepButton} border-text-muted`}>
          <span aria-hidden="true">−</span>
          <span className="sr-only">Færre reps</span>
        </button>
        <output aria-live="polite" className="min-w-[3ch] text-center font-display text-32 font-bold tabular-nums">
          {value}
        </output>
        <button type="button" disabled={value >= max} onClick={() => change(1)} className={`${stepButton} border-text-muted`}>
          <span aria-hidden="true">+</span>
          <span className="sr-only">Flere reps</span>
        </button>
      </div>
    </div>
  );
}

/** §3: the pause between sets of one exercise, with the recommended-rest band. */
export function PauseCard({ since, exercise, onAnnounce }: { readonly since: string; readonly exercise: FokusExercise; readonly onAnnounce: (s: string) => void }) {
  const seconds = useElapsed(since);
  const band = restBand(seconds, exercise.restMinS, exercise.restMaxS);
  const label = restLabel(exercise.restMinS, exercise.restMaxS);
  const said = useRef<string | null>(null);
  useEffect(() => {
    // Once at the minimum and once at the maximum, never the timer itself (§9).
    if (band.kind !== said.current && (band.kind === "ready" || band.kind === "over")) {
      const sentence = restSentence(band, exercise.restMinS, exercise.restMaxS);
      if (said.current !== null && sentence !== null) onAnnounce(sentence);
    }
    said.current = band.kind;
  }, [band, exercise.restMinS, exercise.restMaxS, onAnnounce]);
  const rail = exercise.restMinS !== null && exercise.restMaxS !== null ? restRail(seconds, exercise.restMinS, exercise.restMaxS) : null;
  const ok = band.kind === "ready" || band.kind === "over";
  return (
    <section aria-label="Pause" className="mt-3 flex flex-col rounded-card bg-surface p-4 shadow-card">
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-14 font-bold tracking-[0.04em] text-text-muted uppercase">Pause</span>
        {label !== null && <span className="text-14 font-semibold text-text">{label}</span>}
      </p>
      <div className="mt-1">
        <RestTimer seconds={seconds} label="Pause" positive={ok} />
      </div>
      {rail !== null && (
        <div aria-hidden="true" className="relative mt-2 h-2 w-full bg-track">
          <div className="absolute inset-y-0 left-0 bg-slab" style={{ width: `${rail.fill * 100}%` }} />
          <div className="absolute -inset-y-0.5 w-0.5 bg-text" style={{ left: `${rail.min * 100}%` }} />
          <div className="absolute -inset-y-0.5 w-0.5 bg-text" style={{ left: `${rail.max * 100}%` }} />
        </div>
      )}
      {band.kind !== "none" && (
        <p className={`mt-2 flex items-center gap-1 text-16 font-semibold ${ok ? "text-positive" : "text-text-muted"}`}>
          {ok && <Check className="size-4" />}
          {band.text}
        </p>
      )}
    </section>
  );
}

/** §2: the warm-up of `exercise`, with Python's ramp on a main lift. */
export function WarmupCard({ since, exercise, mainLift }: { readonly since: string; readonly exercise: FokusExercise; readonly mainLift: boolean }) {
  const seconds = useElapsed(since);
  const ramp = rampState(exercise, mainLift);
  const basis = rampBasis(exercise);
  return (
    <section aria-labelledby="fokus-warmup" className="mt-3 flex flex-col rounded-card bg-surface p-4 shadow-card">
      <h2 id="fokus-warmup" className="font-display text-32 leading-[1.05] font-extrabold uppercase italic [overflow-wrap:anywhere]">
        {warmupTitle(exercise)}
      </h2>
      <div className="mt-2">
        <RestTimer seconds={seconds} label="Opvarmning" />
      </div>
      {ramp === "ramp" && exercise.ramp !== null && (
        <div className="mt-3 flex flex-col">
          {basis !== null && <p className="text-14 text-text-muted">{basis}</p>}
          <ol aria-label="Opvarmningssæt" className="mt-1 grid grid-cols-[repeat(auto-fit,minmax(min(100%,6.5rem),1fr))] gap-2">
            {exercise.ramp.map((r) => (
              <li key={r.pct} className="flex flex-col">
                <span className="font-display text-24 font-extrabold tabular-nums italic">
                  {formatKg(r.kg)}&nbsp;kg
                </span>
                <span className="text-14 text-text-muted tabular-nums">
                  {r.reps} reps · {Math.round(r.pct)}&nbsp;%
                </span>
                <span aria-hidden="true" className="mt-1 block h-1 bg-slab" style={{ width: `${Math.min(100, r.pct)}%` }} />
              </li>
            ))}
          </ol>
        </div>
      )}
      {ramp === "none" && <p className="mt-3 text-16 text-text-muted">Intet kg at regne opvarmningen ud fra.</p>}
    </section>
  );
}

/** §1.2: the next set, small (mini slab), with last week and the coach's note. */
export function NextSetCard({ next, week, inWarmup }: { readonly next: SetInContext; readonly week: number; readonly inWarmup: boolean }) {
  const summary = nextSetSummary(next, inWarmup);
  const e = next.exercise;
  // The card always has a last-week line (§1.2.3), suggestion or not.
  const lastWeek = lastWeekLine({ ...e, suggestedKg: e.suggestedKg ?? 0 }, week);
  return (
    <div className="mt-3 flex flex-col gap-1 rounded-control bg-slab p-3 text-on-slab">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded-mark bg-slab-mark px-2 py-0.5 text-14 font-bold tracking-[0.08em] text-slab uppercase">Næste</span>
        <span className="text-20 font-bold">{summary.title}</span>
      </p>
      <p className="text-16 font-medium tabular-nums">{summary.line}</p>
      {lastWeek !== null && (
        <p className="text-16">
          {lastWeek.kind === "kg" ? (
            <>
              <span className="text-on-slab-muted">Sidste uge</span> <span className="font-semibold">{lastWeek.text}</span>
            </>
          ) : (
            <span className="text-on-slab-muted">{lastWeek.text}</span>
          )}
        </p>
      )}
      {e.notes !== null && e.notes.trim() !== "" && <Note text={e.notes.trim()} />}
    </div>
  );
}

function Note({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > NOTE_CLAMP_CHARS;
  return (
    <div className="flex flex-col items-start">
      <p className={`text-16 [overflow-wrap:anywhere] ${long && !open ? "line-clamp-2" : ""}`}>Note: {text}</p>
      {long && !open && (
        <button type="button" onClick={() => setOpen(true)} className={`-my-2.5 min-h-11 text-16 font-semibold underline decoration-1 underline-offset-3 ${IN_SLAB_FOCUS}`}>
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
    <p suppressHydrationWarning className="mt-4 text-16 font-medium text-text-muted tabular-nums">
      {text}
    </p>
  );
}

/** A main lift (squat, bench, deadlift as the competition lift): its warm-up names a missing ramp. */
export function isMainLift(e: FokusExercise): boolean {
  const first = exerciseName(e).toLowerCase().split(/\s+/)[0] ?? "";
  return e.ramp !== null || ["squat", "bench", "bænkpres", "deadlift", "dødløft"].includes(first);
}
