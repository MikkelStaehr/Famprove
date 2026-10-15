"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { settle, useSetLog } from "@/components/useSetLog";
import { HomeLink } from "./HomeLink";
import {
  begunText,
  BEGIN_UNDONE_HREF,
  begunWarmup,
  displayName,
  exerciseUnder,
  FINISHED_SENTENCE,
  finishCard,
  type FokusExercise,
  fokusView,
  kgBlock,
  lastTapText,
  lastWeekLine,
  pauseSentence,
  prescribedCell,
  rangeFigure,
  type SetInContext,
  setInContext,
  setOneOf,
  setSentence,
  setTitle,
  skippedText,
  skipSentence,
  undoSentence,
  unsavedText,
  warmupSentence,
  isMainLift,
  rampState,
} from "@/lib/fokus-view";
import { adjustmentLine, CAPPED_WORD, spokenName } from "@/lib/training-view";
import { type DotRow as DotRowMarks, dotRow, type Signature, signature } from "@/lib/fokus-marks";
import {
  applyTap,
  isWarmup,
  lastTap,
  type LoggedSet,
  nextOpen,
  progress,
  restStart,
  type SetRef,
  setKey,
  stateOf,
} from "@/lib/set-taps";

import { FokusProgress } from "./FokusProgress";
import { Icon } from "@/components/icons";
import { CAPTION, CheckIcon, COMPACT_SECONDARY, FokusWarning as WarningLine, MUTED_LINK, OUTLINED, PRIMARY_BOX, PRIMARY_DOCK } from "./Instrument";
import { SessionSignature } from "./SessionSignature";
import { FeelBlock, Footer, NextSetCard, PauseCard, PrimaryButton, WarmupCard } from "./PauseParts";
import { useWakeLock } from "./useWakeLock";

export type FokusSession = {
  readonly session: number;
  readonly week: number;
  readonly exercises: readonly FokusExercise[];
  readonly order: readonly SetRef[];
  readonly log: readonly LoggedSet[];
};

type FokusScreenProps = {
  readonly session: FokusSession;
  readonly date: string; // the screen's date (the set log's date)
  /** Fokus stale sentence (§6), null when fresh. */
  readonly staleNote: string | null;
  /** The dev switches are on (the server knows before the first tap): nothing is saved. */
  readonly devSwitches: boolean;
  /** Entered from Træning (Begynd / Fortsæt): open the set view even mid-rest (§4.5). */
  readonly enteredFromTraening: boolean;
  /** The catalogue's main-lift name and alias keys (lib/fokus-view mainLiftKeys); null when unread. */
  readonly mainLifts: readonly string[] | null;
};

// Part B Motion: a 120ms opacity cross-fade between views, 0ms under reduced motion.
const FADE_IN = "transition-opacity duration-120 ease-out starting:opacity-0 motion-reduce:transition-none";

/**
 * `/fokus` (spec traening.md §4): one set at a time, rebuilt from the set log on every load.
 * Three view states with one primary action each: set (Udført), rest (Til næste sæt), finished
 * (Tilbage til Træning). Taps go through useSetLog (optimistic, saved in order). "Til næste
 * sæt" writes nothing: it only dismisses the current rest.
 */
export function FokusScreen({ session, date, staleNote, devSwitches, enteredFromTraening, mainLifts }: FokusScreenProps) {
  const { log, tap, unsaved, retry, rejected, dev, flush, failedNow } = useSetLog(session.log, session.order, date, session.session);
  const [dismissed, setDismissed] = useState<string | null>(() =>
    enteredFromTraening ? restStart(new Map(session.log.map((l) => [setKey(l), l]))) : null,
  );
  const [announcement, setAnnouncement] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const primary = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const router = useRouter();

  useWakeLock();

  // Entered with ?view=set: drop it, so a reload rebuilds the view from the log alone (§4.5).
  useEffect(() => {
    if (enteredFromTraening) window.history.replaceState(null, "", "/fokus");
  }, [enteredFromTraening]);

  // After each action, focus the new view's one primary button (§4.7): never <body>.
  useEffect(() => {
    if (focusRequest > 0) primary.current?.focus();
  }, [focusRequest]);

  const view = fokusView(session.order, log, dismissed);
  const p = progress(session.order, log);
  const latest = lastTap(log);
  const at = useCallback((ref: SetRef) => setInContext(session.exercises, ref), [session.exercises]);

  const after = (message: string) => {
    setAnnouncement(message);
    setFocusRequest((n) => n + 1);
  };

  const onDone = (current: SetInContext) => {
    const following = nextOpen(session.order, log, current.ref);
    tap("done", current.ref);
    const next = following === null ? null : at(following);
    after(
      following === null
        ? FINISHED_SENTENCE
        : isWarmup(following) && next !== null
          ? warmupSentence(current, next.exercise)
          : pauseSentence(current),
    );
  };

  const onSkip = (current: SetInContext) => {
    const following = nextOpen(session.order, log, current.ref);
    const next = following === null ? null : at(following);
    tap("skip", current.ref);
    const then =
      next === null
        ? FINISHED_SENTENCE
        : isWarmup(next.ref)
          ? warmupSentence(null, next.exercise)
          : setSentence(next, session.week);
    after(`${skipSentence(current)} ${then}`);
  };

  /** "Til sæt 1": a done on the warm-up, which ends it and starts set 1 (no rest timer). */
  const onWarmupEnd = (warmup: SetRef) => {
    tap("done", warmup);
    const one = at(setOneOf(warmup));
    after(one === null ? "" : setSentence(one, session.week));
  };

  const onNext = (since: string, next: SetInContext | null) => {
    setDismissed(since);
    after(next === null ? "" : setSentence(next, session.week));
  };

  const onFeelOrReps = useCallback(
    (kind: "feel" | "reps", ref: SetRef, value: number | null) => tap(kind, ref, value),
    [tap],
  );

  const begun = begunWarmup(session.order, log);

  const onUndo = () => {
    if (latest === null) {
      // Fortryd of "Begynd træning" (§6): the warm-up row goes, and Træning shows Begynd again.
      if (begun === null) return;
      tap("undo", begun.ref);
      // Træning says "not begun" and focuses Begynd only when the undo was saved; else it shows the truth.
      void settle(flush).then((sent) => router.push(sent && failedNow() === 0 ? BEGIN_UNDONE_HREF : "/"));
      return;
    }
    const undone = at(latest.ref);
    // The reopened set shows in the set view, even if an earlier done tap is now the latest.
    setDismissed(restStart(applyTap(session.order, log, "undo", latest.ref, new Date().toISOString())));
    tap("undo", latest.ref);
    after(
      undone === null
        ? ""
        : isWarmup(latest.ref)
          ? `Fortrudt: ${spokenName(undone.exercise)}, opvarmning er i gang igen.`
          : undoSentence(undone),
    );
  };

  const lastLine =
    latest !== null ? lastTapText(session.exercises, latest) : begun !== null ? begunText(begun.at) : null;
  const skipped = skippedText(p);
  // The barcode's "now" tick (ink since round 2): the set the view is about (none when finished).
  const now =
    view.kind === "set" ? view.current : view.kind === "pause" ? view.next : view.kind === "warmup" ? setOneOf(view.warmup) : null;

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="sr-only">Fokus</h1>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {/* Top bar: fixed in layout, so the card never jumps (§4.1). */}
      <div className="flex items-center justify-between gap-3">
        <HomeLink flush={flush} className={COMPACT_SECONDARY}>
          <Icon name="x" size={18} />
          Afslut
        </HomeLink>
      </div>
      {(devSwitches || dev) && <p className="mt-2 font-mono text-13 text-text-muted">Testvisning: sæt gemmes ikke.</p>}
      {/* The progress with its count beside it (round 3): "0/19" on screen, the full sentence spoken. */}
      <div className="mt-2 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <FokusProgress
            order={session.order.filter((ref) => !isWarmup(ref))}
            stateOf={(ref) => stateOf(log.get(setKey(ref)))}
            current={now}
          />
        </div>
        <p className="shrink-0 font-mono text-16 leading-none font-medium tabular-nums">
          <span aria-hidden="true">
            {p.done}/{p.total}
          </span>
          <span className="sr-only">
            {p.done} af {p.total} sæt udført{skipped}
          </span>
        </p>
      </div>
      <div className="mt-2 flex min-h-11 flex-col justify-center">
        {staleNote !== null && <WarningLine>{staleNote}</WarningLine>}
        {unsaved > 0 && (
          <WarningLine>
            {unsavedText(unsaved)} De står her, men forsvinder, hvis siden genindlæses.{" "}
            <button
              type="button"
              onClick={retry}
              className={`min-h-11 px-4 ${OUTLINED}`}
            >
              Gem igen
            </button>
          </WarningLine>
        )}
        {rejected && <WarningLine>Et tryk blev afvist. Genindlæs siden.</WarningLine>}
        {/* Fortryd alone on its row (round 3); what it undoes is the sr-only rest of its name (WCAG 2.5.3: starts with the label). */}
        {lastLine !== null && (
          <p className="flex justify-end">
            <button type="button" onClick={onUndo} className={COMPACT_SECONDARY}>
              Fortryd<span className="sr-only">: {lastLine}</span>
            </button>
          </p>
        )}
      </div>

      {view.kind === "set" && (
        <SetView
          key={`set-${setKey(view.current)}`}
          current={at(view.current)}
          week={session.week}
          dots={dotRow(session.exercises, session.order, log)}
          primary={primary}
          onDone={onDone}
          onSkip={onSkip}
        />
      )}
      {view.kind === "pause" && (
        <PauseView
          key={`pause-${view.since}`}
          since={view.since}
          done={at(view.done)}
          next={at(view.next)}
          week={session.week}
          logged={log.get(setKey(view.done))}
          primary={primary}
          onNext={onNext}
          onTap={onFeelOrReps}
          onAnnounce={setAnnouncement}
        />
      )}
      {view.kind === "warmup" && (
        <WarmupView
          key={`warmup-${setKey(view.warmup)}`}
          since={view.since}
          mainLifts={mainLifts}
          warmup={view.warmup}
          setOne={at(setOneOf(view.warmup))}
          week={session.week}
          feel={view.feel === null ? null : at(view.feel)}
          logged={view.feel === null ? undefined : log.get(setKey(view.feel))}
          primary={primary}
          onWarmupEnd={onWarmupEnd}
          onTap={onFeelOrReps}
        />
      )}
      {view.kind === "finished" && (
        <FinishedView
          session={session.session}
          card={finishCard(session.session, p, log)}
          marks={signature(session.exercises, session.order, log)}
          primary={primary}
          flush={flush}
          feel={view.feel === null ? null : at(view.feel)}
          logged={view.feel === null ? undefined : log.get(setKey(view.feel))}
          onTap={onFeelOrReps}
          footer={<Footer order={session.order} log={log} />}
        />
      )}
    </div>
  );
}

type PrimaryRef = RefObject<(HTMLButtonElement & HTMLAnchorElement) | null>;

/**
 * §4.2 + round 4 §2: the current set. One value row (REPS · RPE/PROCENT · today's kg, fokus-kg.md, the
 * unit once), then the dot row and the adjustment; Spring over as a muted link; Udført the one ink
 * slab. NOTES is never shown: its text is the variant (user, 2026-10-15), already the title.
 */
function SetView({
  current,
  week,
  dots,
  primary,
  onDone,
  onSkip,
}: {
  readonly current: SetInContext | null;
  readonly week: number;
  readonly dots: DotRowMarks;
  readonly primary: PrimaryRef;
  readonly onDone: (s: SetInContext) => void;
  readonly onSkip: (s: SetInContext) => void;
}) {
  if (current === null) return null; // the order and the rows come from the same sets: not reached
  const e = current.exercise;
  const kg = kgBlock(e);
  const adjustment = adjustmentLine(e);
  const lastWeek = lastWeekLine(e, week);
  const cell = prescribedCell(e.prescribed);
  const under = exerciseUnder(e);
  return (
    <div className={`flex flex-1 flex-col ${FADE_IN}`}>
      <section aria-labelledby="fokus-set" className="mt-4 flex flex-1 flex-col">
        {/* reset-fokus.md §3: the figure block in a hero Card (26, padding 20); its old margins are the card's. */}
        <div className="mb-10 flex flex-col rounded-hero border border-border bg-card p-5">
        <h2 id="fokus-set" className="font-sans text-32 font-semibold [overflow-wrap:anywhere] text-balance">
          {displayName(e)}
        </h2>
        {/* variants.md §3: the sheet's exercise muted under the variant (4px, same block). */}
        {under !== null && <p className="mt-1 font-sans text-16 text-balance text-text-muted">{under}</p>}
        <p className={`${CAPTION} mt-3`}>{setTitle(current)}</p>

        {/* One value row; below 21rem the kg column takes its own line (200 % text). */}
        <div className="@container mt-10">
          <div className="grid grid-cols-[auto_auto] gap-x-6 gap-y-3 @min-[21rem]:grid-cols-[auto_auto_1fr]">
            {e.repsText !== null && (
              <p className="flex flex-col [overflow-wrap:anywhere]">
                <span className={CAPTION}>Reps</span>
                <span className={FIGURE}>{rangeFigure(e.repsText)}</span>
              </p>
            )}
            {cell !== null && (
              <p className="flex flex-col [overflow-wrap:anywhere]">
                <span className={CAPTION}>{cell.caption ?? "\u00a0"}</span>
                <span>
                  <span className={FIGURE}>{cell.value}</span>
                  {cell.unit !== null && <span className="text-20 text-text-muted">{cell.unit}</span>}
                </span>
              </p>
            )}
            {kg !== null && (
              // fokus-kg.md §1: today's kg; the visual copy is aria-hidden, §4's sentence is said once.
              <p
                className={`flex flex-col [overflow-wrap:anywhere] ${
                  hasWords(kg.figure) ? "col-span-full @min-[21rem]:col-span-full" : "col-span-2 @min-[21rem]:col-span-1"
                }`}
              >
                <span className="sr-only">{`${capitalise(kg.spoken)}.`}</span>
                <span aria-hidden="true" className={CAPTION}>
                  {kg.caption}
                </span>
                <span aria-hidden="true" className={kg.italic ? "italic" : undefined}>
                  {hasWords(kg.figure) ? <FigureWithWords figure={kg.figure} /> : <span className={FIGURE}>{kg.figure}</span>}
                  {kg.unit !== null && <span className="text-24 text-text-muted">{"\u00a0"}kg</span>}
                  {kg.capped && <span className="font-sans text-16 not-italic text-text-muted"> {CAPPED_WORD}</span>}
                </span>
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          <DotRow dots={dots} />
          {kg?.basis === "e1rm" && adjustment !== null && (
            <p className="text-16 text-text-muted">
              {adjustment.signed !== "" && <span className="font-medium text-text">{adjustment.signed}</span>}
              {adjustment.rest}
            </p>
          )}
          {lastWeek !== null && (
            <p className="text-14 text-text-muted">
              {lastWeek.kind === "kg" ? (
                <>
                  Sidste uge <span className="font-mono text-20 font-medium tabular-nums">{lastWeek.text}</span>
                </>
              ) : (
                lastWeek.text
              )}
            </p>
          )}
        </div>
        </div>

        {/* Secondary action above the primary: nothing sits below Udført (round 2). mt-auto takes the
            free height, so on a short set Udført sits at the bottom edge like the pause's button. */}
        <button type="button" onClick={() => onSkip(current)} className={`mt-auto self-center ${MUTED_LINK}`}>
          Spring over
        </button>

        <div className={`mt-6 ${PRIMARY_DOCK}`}>
          <button ref={primary} type="button" onClick={() => onDone(current)} className={PRIMARY_BOX}>
            <CheckIcon className="size-5" />
            Udført
          </button>
        </div>
      </section>
    </div>
  );
}

/** Round 4 §3.2: sets tapped today, filled = done, ring = skipped, 8px dots with 8px gaps (16px between
 * exercises); the 8px row is reserved when empty. */
function DotRow({ dots }: { readonly dots: DotRowMarks }) {
  return (
    <div className="flex min-h-2 flex-wrap gap-x-4 gap-y-2">
      {dots.groups.map((g) => (
        <svg key={g.key} aria-hidden="true" width={g.width} height={8} viewBox={`0 0 ${g.width} 8`} className="block shrink-0">
          {g.dots.map((d) =>
            d.kind === "done" ? (
              <circle key={d.cx} cx={d.cx} cy={4} r={4} fill="var(--text)" />
            ) : (
              <circle key={d.cx} cx={d.cx} cy={4} r={3.25} fill="none" stroke="var(--text)" strokeWidth={1.5} />
            ),
          )}
        </svg>
      ))}
      <span className="sr-only">{dots.sentence}</span>
    </div>
  );
}

type FeelTap = (kind: "feel" | "reps", ref: SetRef, value: number | null) => void;

/** fokus-pause.md §3 (Variant B): feel, the pause with its recommended rest, the next set. */
function PauseView({
  since,
  done,
  next,
  week,
  logged,
  primary,
  onNext,
  onTap,
  onAnnounce,
}: {
  readonly since: string;
  readonly done: SetInContext | null;
  readonly next: SetInContext | null;
  readonly week: number;
  readonly logged: LoggedSet | undefined;
  readonly primary: PrimaryRef;
  readonly onNext: (since: string, next: SetInContext | null) => void;
  readonly onTap: FeelTap;
  readonly onAnnounce: (s: string) => void;
}) {
  return (
    <div className={`flex flex-1 flex-col ${FADE_IN}`}>
      {done !== null && <FeelBlock set={done} logged={logged} named={false} onTap={onTap} />}
      {done !== null && <PauseCard since={since} exercise={done.exercise} onAnnounce={onAnnounce} />}
      {next !== null && <NextSetCard next={next} week={week} inWarmup={false} afterTimer />}
      <PrimaryButton primary={primary} onClick={() => onNext(since, next)}>
        Til næste sæt
      </PrimaryButton>
    </div>
  );
}

/** fokus-pause.md §2 and §4 (Variants A and C): the warm-up, after the feel of the set before. */
function WarmupView({
  since,
  mainLifts,
  warmup,
  setOne,
  week,
  feel,
  logged,
  primary,
  onWarmupEnd,
  onTap,
}: {
  readonly since: string | null; // null: no recorded start (§2.2), a static 0:00
  readonly mainLifts: readonly string[] | null;
  readonly warmup: SetRef;
  readonly setOne: SetInContext | null;
  readonly week: number;
  readonly feel: SetInContext | null;
  readonly logged: LoggedSet | undefined;
  readonly primary: PrimaryRef;
  readonly onWarmupEnd: (warmup: SetRef) => void;
  readonly onTap: FeelTap;
}) {
  if (setOne === null) return null; // the order and the rows come from the same sets: not reached
  const mainLift = isMainLift(setOne.exercise, mainLifts);
  return (
    <div className={`flex flex-1 flex-col ${FADE_IN}`}>
      {feel !== null && <FeelBlock set={feel} logged={logged} named onTap={onTap} />}
      <div className={feel !== null ? "mt-10" : "mt-4"}>
        <WarmupCard since={since} exercise={setOne.exercise} mainLift={mainLift} />
      </div>
      <NextSetCard next={setOne} week={week} inWarmup afterTimer={rampState(setOne.exercise, mainLift) === "hidden"} />
      <PrimaryButton primary={primary} onClick={() => onWarmupEnd(warmup)}>
        Til sæt 1
      </PrimaryButton>
    </div>
  );
}

/** §4.4: the finish card and the way back. */
function FinishedView({
  session,
  card,
  marks,
  primary,
  flush,
  feel,
  logged,
  onTap,
  footer,
}: {
  readonly session: number;
  readonly card: ReturnType<typeof finishCard>;
  readonly marks: Signature;
  readonly primary: PrimaryRef;
  readonly flush: () => Promise<void>;
  readonly feel: SetInContext | null;
  readonly logged: LoggedSet | undefined;
  readonly onTap: FeelTap;
  /** "Tid brugt …": shown only here since round 3. */
  readonly footer: ReactNode;
}) {
  return (
    <div className={`flex flex-1 flex-col ${FADE_IN}`}>
      {feel !== null && <FeelBlock set={feel} logged={logged} named onTap={onTap} />}
      <section aria-labelledby={`fokus-finished-${session}`} className={`${feel !== null ? "mt-10" : "mt-4"} flex flex-col`}>
        <h2 id={`fokus-finished-${session}`} className="font-sans text-28 font-semibold tracking-[-0.01em]">
          {card.title}
        </h2>
        {/* reset-fokus.md §3: the counts in a hero Card. */}
        <div className="mt-10 flex flex-col gap-3 rounded-hero border border-border bg-card px-5 pt-5.5 pb-4">
          <CountsFigure text={card.counts} />
          <SessionSignature marks={marks} />
          {card.times !== null && <p className={CAPTION}>{card.times}</p>}
          {footer}
        </div>
      </section>
      <div aria-hidden="true" className="flex-1" />
      <div className={`mt-10 ${PRIMARY_DOCK}`}>
        <HomeLink ref={primary} flush={flush} className={PRIMARY_BOX}>
          Tilbage til Træning
        </HomeLink>
      </div>
    </div>
  );
}

/** finishCard's counts sentence with its first number as the mono key figure (copy unchanged). */
function CountsFigure({ text }: { readonly text: string }) {
  const m = /^(\D*?)(\d+)(.*)$/.exec(text);
  if (m === null) return <p className="text-16 text-text-muted">{text}</p>;
  return (
    <p className="text-16 text-text-muted">
      {m[1]}
      <span className="font-mono text-56 font-medium text-text tabular-nums">{m[2]}</span>
      {m[3]}
    </p>
  );
}

/** Reps, RPE and kg (DESIGN.md text-44: Fokus reps / kg figures; the timer is text-56): Geist Mono 500, −0.03em, tabular. */
const FIGURE = "font-mono text-44 font-medium tabular-nums";

/** fokus-kg.md §4: the spoken kg as its own sentence ("I dag 142,5 kg."). */
const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** A kg figure with words in it ("kropsvægt + 10"), not a plain number. */
const hasWords = (figure: string): boolean => /\p{L}/u.test(figure);

/**
 * A kg figure that may start with words ("kropsvægt + 10"): the words in text-24 so only the
 * number is 44px; its cell takes the full row under REPS/RPE (col-span-full), so "kropsvægt + 10 kg"
 * sits on one line instead of wrapping in the third column. A plain number is all 44px.
 */
function FigureWithWords({ figure }: { readonly figure: string }) {
  const m = /^(\D+?)\s*(\d[\d,.]*)$/.exec(figure);
  if (m === null) return <span className={FIGURE}>{figure}</span>;
  return (
    <>
      <span className="font-sans text-24">{m[1]} </span>
      <span className={FIGURE}>{m[2]}</span>
    </>
  );
}
