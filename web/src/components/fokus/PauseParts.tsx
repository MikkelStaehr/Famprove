"use client";

import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";

import {
  displayName,
  exerciseUnder,
  FEEL_OPTIONS,
  feelQuestion,
  footerText,
  type FokusExercise,
  type RestWindow,
  nextFeel,
  nextSetSummary,
  rampBasis,
  rampState,
  rangeFigure,
  repsRange,
  restAdvice,
  restBand,
  restBandLine,
  restRail,
  restSentence,
  type SetInContext,
  stepperBounds,
  stepperValue,
  warmupTitle,
} from "@/lib/fokus-view";
import type { LoggedSet, SetRef } from "@/lib/set-taps";
import { dotField, FIELD_WIDTH } from "@/lib/fokus-marks";

import { Icon } from "@/components/icons";

import { CAPTION, CheckIcon, PRIMARY_BOX, PRIMARY_DOCK } from "./Instrument";
import { type RestSignal, restSignal } from "@/lib/rest-signal";
import { sessionStore, sharedVibrator } from "@/lib/fokus-snapshot";
import { RestTimer, useElapsed } from "./RestTimer";

type PrimaryRef = RefObject<(HTMLButtonElement & HTMLAnchorElement) | null>;

/** reset-fokus.md §3: the pause and warm-up surfaces are Cards (radius 22, padding 20). */
const CARD = "flex flex-col rounded-card border border-border bg-card p-5";

/**
 * The done in the dock (fokus-flow.md §1.5, §2): the one light button, "✓ Sæt 2 udført" /
 * "✓ Opvarmning udført"; `spoken` is its accessible name (§5, contains the visible words).
 */
export function DoneButton({
  primary,
  onClick,
  visible,
  spoken,
  stop = false,
}: {
  readonly primary: PrimaryRef;
  readonly onClick: () => void;
  readonly visible: string;
  readonly spoken: string;
  /** video-record.md §7: while recording, a 10px --inverse-text square instead of the check. */
  readonly stop?: boolean;
}) {
  return (
    <>
      {/* Takes the free height of a short view, so the button sits at the bottom edge (user, 2026-10-13). */}
      <div aria-hidden="true" className="flex-1" />
      <div className={`mt-3 ${PRIMARY_DOCK}`}>
        <button ref={primary} type="button" aria-label={spoken} onClick={onClick} className={PRIMARY_BOX}>
          {stop ? <span aria-hidden="true" className="inline-block size-2.5 bg-inverse-text" /> : <CheckIcon className="size-4.5" />}
          {visible}
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
  hideReps = false,
}: {
  readonly set: SetInContext;
  readonly logged: LoggedSet | null;
  readonly named: boolean;
  readonly onTap: (kind: "feel" | "reps", ref: SetRef, value: number | null) => void;
  /** combo-parts.md §1: the parts editor replaces the reps stepper for a set whose variant has parts. */
  readonly hideReps?: boolean;
}) {
  const id = useId();
  const range = hideReps ? null : repsRange(set.exercise.repsText);
  const felt = logged?.feltRpe ?? null;
  return (
    // fokus-flow.md §1.4: optional, on --bg (no card); the group's name says so (§5).
    <section role="group" aria-label={`${feelQuestion(set, named)} Valgfrit.`} className="flex flex-col">
      <p aria-hidden="true" id={`${id}-q`} className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-sans text-16 font-medium">{feelQuestion(set, named)}</span>
        <span className={CAPTION}>Valgfrit</span>
      </p>
      {/* button-type.md B5: three separate dark buttons, 56px, gap 8px; the chosen one has the
          --raised fill and a check icon, so the choice is never carried by fill alone. */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {FEEL_OPTIONS.map((o) => {
          const on = felt === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              aria-label={o.label}
              onClick={() => onTap("feel", set.ref, nextFeel(felt, o.value))}
              className={`relative flex min-h-14 items-center justify-center gap-1 rounded-button border border-text-muted px-1 text-center text-button text-text transition-colors duration-[120ms] ease-out active:opacity-85 ${
                on ? "bg-raised" : "bg-card"
              }`}
            >
              {on && <Icon name="check" size={16} />}
              {o.label}
            </button>
          );
        })}
      </div>
      {range !== null && (
        <RepsStepper
          set={set}
          named={named}
          top={range.top}
          figure={rangeFigure(set.exercise.repsText ?? "")}
          logged={logged?.repsDone ?? null}
          onTap={onTap}
        />
      )}
    </section>
  );
}

function RepsStepper({
  set,
  named,
  figure,
  top,
  logged,
  onTap,
}: {
  readonly set: SetInContext;
  readonly named: boolean;
  /** The range as the sheet writes it (rangeFigure: "10–6" stays reversed, range-order). */
  readonly figure: string;
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
        <span className="font-sans text-16">
          Reps i sæt {set.number}
          {named && ` · ${displayName(set.exercise)}`}
        </span>
        {/* A small tabular number, not a caption label: mono in the muted grey (Barley Corn is for captions only). */}
        <span className="font-mono text-14 text-text-muted">
          {figure}
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

/**
 * fokus-flow.md §1.2: the rest strip above the next set. PAUSE ↔ "Anbefalet 3–5 min", the timer,
 * the rail (--track, the recommended span --shade-2, the now tick --text) and the band line with a
 * check icon once ready (words carry it, never colour). Null rest values: the timer only. Crossing
 * the minimum vibrates once (lib/rest-signal) and is announced once; the timer never is.
 */
export function RestStrip({
  since,
  rest: { minS, maxS, superset },
  onAnnounce,
}: {
  readonly since: string;
  /** fokusView's restWindow; `superset`: the rest after a superset's B (supersets.md S14), the label says so. */
  readonly rest: RestWindow;
  readonly onAnnounce: (s: string) => void;
}) {
  const seconds = useElapsed(since);
  const band = restBand(seconds, minS, maxS);
  const signal = useRef<{ readonly since: string; readonly s: RestSignal } | null>(null);
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (signal.current?.since !== since) signal.current = { since, s: restSignal(since, minS, sharedVibrator(sessionStore(), since, navigator)) };
    const visible = document.visibilityState === "visible";
    if (signal.current.s.tick(Date.now(), visible)) {
      const sentence = restSentence({ kind: "ready" }, minS, maxS);
      if (sentence !== null) onAnnounce(sentence);
    }
    // "Pausen er over 5 minutter." once, when the maximum is crossed while watched (not on load).
    if (band.kind === "over" && said.current !== null && said.current !== "over") {
      const sentence = restSentence(band, minS, maxS);
      if (sentence !== null) onAnnounce(sentence);
    }
    said.current = band.kind;
  }, [seconds, since, band, minS, maxS, onAnnounce]);
  const advice = restAdvice(minS, maxS);
  const line = restBandLine(band, minS, maxS);
  const rail = minS !== null && maxS !== null ? restRail(seconds, minS, maxS) : null;
  return (
    <section aria-label="Pause" className="flex min-h-(--h-fokus-strip) flex-col rounded-card border border-border bg-card p-4">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className={CAPTION}>Pause</span>
        {advice !== null && <span className="font-mono text-13 text-text-muted">{superset ? `${advice} · superset` : advice}</span>}
      </p>
      <div className="mt-2">
        <RestTimer seconds={seconds} label="Pause" />
      </div>
      {rail !== null && (
        <div aria-hidden="true" className="relative mt-3 h-4">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-pill bg-track" />
          <div className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-shade-2" style={{ left: frac(rail.min), width: frac(rail.max - rail.min) }} />
          <div className="absolute top-0 h-4 w-0.5 -translate-x-1/2 bg-text" style={{ left: frac(rail.fill) }} />
        </div>
      )}
      {line !== null && (
        <p className={`mt-3 flex items-center gap-2 text-16 ${band.kind === "before" ? "text-text-muted" : "text-text"}`}>
          {band.kind !== "before" && <CheckIcon className="size-4.5" />}
          {line}
        </p>
      )}
    </section>
  );
}

/** A 0..1 fraction as a CSS length. */
const frac = (f: number): string => `${Math.min(1, Math.max(0, f)) * 100}%`;

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

/** §2: the warm-up of `exercise`; on a main lift with Python's ramp only its basis line "Op mod X kg" (warmup-no-ramp, 2026-10-20). */
export function WarmupCard({
  since,
  exercise,
  mainLift,
  extra = null,
}: {
  readonly since: string | null;
  readonly exercise: FokusExercise;
  readonly mainLift: boolean;
  /** fokus-superset.md §2.2: the ⇄ button under the name stack; null = none. */
  readonly extra?: ReactNode;
}) {
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
      {extra}
      <div className="mt-14">
        {/* No recorded start (§2.2): a static 0:00 with the tick at 0, never a clock from page load. */}
        {since === null ? <WarmupClock seconds={0} /> : <WarmupTimer since={since} />}
      </div>
      {/* warmup-no-ramp (2026-10-20, user): the 40/60/80 % rows are gone; the basis line stays. */}
      {ramp === "ramp" && basis !== null && <p className={`mt-14 ${CAPTION}`}>{basis}</p>}
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
