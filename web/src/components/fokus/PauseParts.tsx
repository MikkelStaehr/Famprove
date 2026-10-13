"use client";

import { type RefObject, useEffect, useId, useRef, useState } from "react";

import {
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

import { ArrowIcon, CheckIcon, Hairline, INK_LINK, PRIMARY_FILL } from "./Instrument";
import { RestTimer, useElapsed } from "./RestTimer";

type PrimaryRef = RefObject<(HTMLButtonElement & HTMLAnchorElement) | null>;

export function PrimaryButton({ primary, onClick, children }: { readonly primary: PrimaryRef; readonly onClick: () => void; readonly children: string }) {
  return (
    <button ref={primary} type="button" onClick={onClick} className={`mt-10 ${PRIMARY_FILL}`}>
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
      <h2 id={`${id}-q`} className="font-grotesk text-20 font-normal">
        {feelQuestion(set, named)}
      </h2>
      <div role="group" aria-labelledby={`${id}-q`} className="mt-3 grid grid-cols-3 gap-2">
        {FEEL_OPTIONS.map((o) => {
          const on = felt === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              aria-label={o.label}
              onClick={() => onTap("feel", set.ref, nextFeel(felt, o.value))}
              className={`flex min-h-14 flex-col items-center justify-center gap-1.5 px-2 font-grotesk text-16 leading-tight font-medium text-text ${
                on ? "border-2 border-text" : "border border-text-muted"
              }`}
            >
              {/* The lamp: filled ink when lit, hollow when off (shape, not colour alone; red is the primary's). */}
              <span aria-hidden="true" data-lamp={on ? "on" : "off"} className={`block size-2.5 shrink-0 ${on ? "bg-text" : "border border-text-muted"}`} />
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
    <section aria-label="Pause" className="mt-14 flex flex-col">
      <p className="flex items-baseline justify-between gap-2">
        <span className="caption">Pause</span>
        {label !== null && <span className="caption">{label}</span>}
      </p>
      <div className="mt-3">
        <RestTimer seconds={seconds} label="Pause" />
      </div>
      {rail !== null && exercise.restMaxS !== null && (
        <Scale scaleS={1.2 * exercise.restMaxS} now={rail.fill} min={rail.min} max={rail.max} />
      )}
      {band.kind !== "none" && (
        <p className={`mt-3 flex items-center gap-2 text-16 ${ok ? "text-text" : "text-text-muted"}`}>
          {ok && <CheckIcon className="size-4 text-text" />}
          {band.text}
        </p>
      )}
    </section>
  );
}

/** A position on the scale, kept inside it: `width` is the mark's width in px. */
function at(fraction: number, width: number): string {
  return `calc(${Math.min(1, Math.max(0, fraction))} * (100% - ${width}px))`;
}

/**
 * The timer's scale (fokus-instrument.md §4.4), directly under the clock: 0 … `scaleS`, ticks every
 * 30 s, labelled minutes, the red "now" tick, which jumps once a second (no transition) and stays
 * pinned at the right end past the scale. The pause adds its MIN and MAX marks; the warm-up has none
 * (no recommended rest).
 */
function Scale({ scaleS, now, min, max }: { readonly scaleS: number; readonly now: number; readonly min?: number; readonly max?: number }) {
  const ticks: number[] = [];
  for (let t = 0; t <= scaleS; t += 30) ticks.push(t);
  const marks = min !== undefined && max !== undefined;
  return (
    <div aria-hidden="true" data-scale-s={scaleS} className={`relative mt-3 w-full ${marks ? "h-17" : "h-11"}`}>
      <span className="absolute inset-x-0 bottom-4 block h-px bg-text-muted" />
      {ticks.map((t) =>
        t % 60 === 0 ? (
          <span key={t}>
            <span className="absolute bottom-4 block h-3 w-px bg-text" style={{ left: at(t / scaleS, 1) }} />
            <span className="absolute bottom-0 -translate-x-1/2 font-mono text-12 leading-none text-text-muted" style={{ left: at(t / scaleS, 1) }}>
              {t / 60}
            </span>
          </span>
        ) : (
          <span key={t} className="absolute bottom-4 block h-1.5 w-px bg-text-muted" style={{ left: at(t / scaleS, 1) }} />
        ),
      )}
      {marks && (
        <>
          <span className="absolute bottom-4 block h-6 w-0.5 bg-text" style={{ left: at(min, 2) }} />
          <span className="caption absolute top-0 -translate-x-1/2 leading-none" style={{ left: at(min, 2) }}>
            Min
          </span>
          <span className="absolute bottom-4 block h-6 w-px bg-text" style={{ left: at(max, 1) }} />
          <span className="caption absolute top-0 -translate-x-1/2 leading-none" style={{ left: at(max, 1) }}>
            Max
          </span>
        </>
      )}
      <span data-now={now} className="absolute bottom-4 block h-7 w-0.5 bg-accent" style={{ left: at(now, 2) }} />
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
      <Scale scaleS={WARMUP_SCALE_S} now={Math.min(1, seconds / WARMUP_SCALE_S)} />
    </>
  );
}

/** §1.2: the next set without a background (Part B): caption + title, a hairline, mono values. */
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
  const summary = nextSetSummary(next, inWarmup);
  const e = next.exercise;
  // The card always has a last-week line (§1.2.3), suggestion or not.
  const lastWeek = lastWeekLine({ ...e, suggestedKg: e.suggestedKg ?? 0 }, week);
  return (
    <div className={`${afterTimer ? "mt-14" : "mt-10"} flex flex-col gap-1`}>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="caption">Næste</span>
        <span className="font-grotesk text-20">{summary.title}</span>
      </p>
      <Hairline className="my-2" />
      <p className="text-16">{summary.line}</p>
      {lastWeek !== null &&
        (lastWeek.kind === "kg" ? (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="caption">Sidste uge</span> <span className="text-16">{lastWeek.text}</span>
          </p>
        ) : (
          <p className="text-16 text-text-muted">{lastWeek.text}</p>
        ))}
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
