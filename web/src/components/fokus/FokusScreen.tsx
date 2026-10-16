"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { settle, useSetLog } from "@/components/useSetLog";
import { HomeLink } from "./HomeLink";
import {
  BEGIN_UNDONE_HREF,
  displayName,
  exerciseUnder,
  type FinishCard,
  type FokusExercise,
  type FokusView,
  fokusView,
  kgBlock,
  lastWeekLine,
  nextCaption,
  prescribedCell,
  rangeFigure,
  unsavedText,
  isMainLift,
  rampState,
} from "@/lib/fokus-view";
import { adjustmentLine, CAPPED_WORD } from "@/lib/training-view";
import { type Signature, signature } from "@/lib/fokus-marks";
import { isWarmup, type LoggedSet, type PairRef, type SetRef, setKey, stateOf } from "@/lib/set-taps";

import { FokusProgress } from "./FokusProgress";
import { Icon } from "@/components/icons";
import { CAPTION, COMPACT_SECONDARY, DARK_BOX, FokusWarning as WarningLine, OUTLINED, SKIP_BUTTON, PRIMARY_DOCK } from "./Instrument";
import { SessionSignature } from "./SessionSignature";
import { DoneButton, FeelBlock, Footer, NextSetCard, RestStrip, WarmupCard } from "./PauseParts";
import { useWakeLock } from "./useWakeLock";

export type FokusSession = {
  readonly session: number;
  readonly week: number;
  readonly exercises: readonly FokusExercise[];
  readonly order: readonly SetRef[];
  readonly log: readonly LoggedSet[];
  /** The supersets in force (supersets.md S10–S17); `order` is already interleaved by them. */
  readonly pairs?: readonly PairRef[];
};

type FokusScreenProps = {
  readonly session: FokusSession;
  readonly date: string; // the screen's date (the set log's date)
  /** Fokus stale sentence (§6), null when fresh. */
  readonly staleNote: string | null;
  /** The dev switches are on (the server knows before the first tap): nothing is saved. */
  readonly devSwitches: boolean;
  /** Entered from Træning (Begynd / Fortsæt) with ?view=set: the query is dropped (the view comes from the log alone). */
  readonly enteredFromTraening: boolean;
  /** The catalogue's main-lift name and alias keys (lib/fokus-view mainLiftKeys); null when unread. */
  readonly mainLifts: readonly string[] | null;
};

// Part B Motion: a 120ms opacity cross-fade between views, 0ms under reduced motion.
const FADE_IN = "transition-opacity duration-120 ease-out starting:opacity-0 motion-reduce:transition-none";

/**
 * `/fokus` (spec traening.md §4): one set at a time, rebuilt from the set log on every load.
 * There is no "start" step (fokus-flow.md): the rest screen IS the next set, its primary the
 * done of that set. Views: set (✓ Sæt n udført, with the rest strip after a done), warm-up
 * (✓ Opvarmning udført), finished (Tilbage til Træning). Taps go through useSetLog (optimistic,
 * saved in order).
 */
export function FokusScreen({ session, date, staleNote, devSwitches, enteredFromTraening, mainLifts }: FokusScreenProps) {
  const { log, tap, unsaved, retry, rejected, dev, flush, failedNow } = useSetLog(session.log, session.order, date, session.session, session.exercises);
  const [announcement, setAnnouncement] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const primary = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const router = useRouter();

  // Entered with ?view=set: drop it, so a reload rebuilds the view from the log alone (§4.5).
  useEffect(() => {
    if (enteredFromTraening) window.history.replaceState(null, "", "/fokus");
  }, [enteredFromTraening]);

  // After each action, focus the new view's one primary button (§4.7): never <body>.
  useEffect(() => {
    if (focusRequest > 0) primary.current?.focus();
  }, [focusRequest]);

  // Every superset rule, label and sentence comes from the view; the screen renders and dispatches taps.
  const view = fokusView({ exercises: session.exercises, pairs: session.pairs ?? [], order: session.order, week: session.week, session: session.session }, log);
  // fokus-flow.md §4: the screen stays on from an open, begun session until it is finished.
  useWakeLock(log.size > 0 && view.kind !== "finished");
  const p = view.progress;

  const after = (message: string) => {
    setAnnouncement(message);
    setFocusRequest((n) => n + 1);
  };

  const onDone = () => {
    if (view.kind !== "set") return;
    tap("done", view.next);
    after(view.announce.done);
  };

  const onSkip = () => {
    if (view.kind !== "set") return;
    tap("skip", view.next);
    after(view.announce.skip);
  };

  /** "✓ Opvarmning udført": a done on the warm-up, which ends it and starts set 1 (its timer counts from this tap). */
  const onWarmupEnd = () => {
    if (view.kind !== "warmup") return;
    tap("done", view.warmup);
    after(view.announce.done);
  };

  const onFeelOrReps = useCallback(
    (kind: "feel" | "reps", ref: SetRef, value: number | null) => tap(kind, ref, value),
    [tap],
  );

  const onUndo = () => {
    const undo = view.undo;
    if (undo === null) return;
    if (undo.kind === "begin") {
      // Fortryd of "Begynd træning" (§6): the warm-up row goes, and Træning shows Begynd again.
      tap("undo", undo.ref);
      // Træning says "not begun" and focuses Begynd only when the undo was saved; else it shows the truth.
      void settle(flush).then((sent) => router.push(sent && failedNow() === 0 ? BEGIN_UNDONE_HREF : "/"));
      return;
    }
    // The reopened set shows in the set layout, the timer counting from the tap before it (F8).
    tap("undo", undo.ref);
    after(undo.announce);
  };

  const lastLine = view.undo?.line ?? null;

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
            current={view.tick}
          />
        </div>
        <p className="shrink-0 font-mono text-16 leading-none font-medium tabular-nums">
          <span aria-hidden="true">
            {p.done}/{p.total}
          </span>
          <span className="sr-only">
            {p.done} af {p.total} sæt udført{view.skipped}
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
          key={`set-${setKey(view.next)}`}
          view={view}
          week={session.week}
          primary={primary}
          onDone={onDone}
          onSkip={onSkip}
          onTap={onFeelOrReps}
          onAnnounce={setAnnouncement}
        />
      )}
      {view.kind === "warmup" && (
        <WarmupView
          key={`warmup-${setKey(view.warmup)}`}
          view={view}
          mainLifts={mainLifts}
          week={session.week}
          primary={primary}
          onWarmupEnd={onWarmupEnd}
          onTap={onFeelOrReps}
        />
      )}
      {view.kind === "finished" && (
        <FinishedView
          session={session.session}
          card={view.card}
          marks={signature(session.exercises, session.order, log)}
          primary={primary}
          flush={flush}
          feel={view.feel}
          onTap={onFeelOrReps}
          footer={<Footer order={session.order} log={log} />}
        />
      )}
    </div>
  );
}

type PrimaryRef = RefObject<(HTMLButtonElement & HTMLAnchorElement) | null>;

type FeelTap = (kind: "feel" | "reps", ref: SetRef, value: number | null) => void;

/**
 * fokus-flow.md §1: one layout for a set and the rest before it. The rest strip (only after a
 * done; `rest` null hides it), the next-set hero card with Spring over inside it, the optional feel
 * row of the set just done, and the done of the next set in the dock. NOTES is never shown.
 */
function SetView({
  view,
  week,
  primary,
  onDone,
  onSkip,
  onTap,
  onAnnounce,
}: {
  readonly view: Extract<FokusView, { kind: "set" }>;
  readonly week: number;
  readonly primary: PrimaryRef;
  readonly onDone: () => void;
  readonly onSkip: () => void;
  readonly onTap: FeelTap;
  readonly onAnnounce: (s: string) => void;
}) {
  const next = view.shown;
  if (next === null || view.label === null) return null; // the order and the rows come from the same sets: not reached
  const e = next.exercise;
  const kg = kgBlock(e);
  const adjustment = adjustmentLine(e);
  const lastWeek = lastWeekLine(e, week);
  const cell = prescribedCell(e.prescribed);
  const under = exerciseUnder(e);
  const label = view.label;
  const line = view.pairLine;
  const feel = view.feel;
  return (
    <div className={`mt-2 flex flex-1 flex-col gap-3 ${FADE_IN}`}>
      {view.showRest && view.rest !== null && view.restWindow !== null && (
        <RestStrip key={view.rest.since} since={view.rest.since} rest={view.restWindow} onAnnounce={onAnnounce} />
      )}
      {/* §1.3: the next set in a hero Card (26, padding 20). */}
      <section aria-labelledby="fokus-set" className="flex flex-col rounded-hero border border-border bg-card p-5">
        <p className={CAPTION}>{nextCaption(next)}</p>
        <h2 id="fokus-set" className="mt-2 font-sans text-32 font-semibold [overflow-wrap:anywhere] text-balance">
          {displayName(e)}
        </h2>
        {/* variants.md §3: the sheet's exercise muted under the variant (4px, same block). */}
        {under !== null && <p className="mt-1 font-sans text-16 text-balance text-text-muted">{under}</p>}
        {line !== null && (
          <p className="mt-2 flex items-center gap-2 font-sans text-14 text-text-muted">
            <Icon name="arrow-left-right" size={16} />
            {line}
          </p>
        )}

        {/* Two columns: reps | today's kg with Sidste uge under it; below 18rem one column (200 % text). */}
        <div className="@container mt-4">
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 @min-[18rem]:grid-cols-[auto_1fr]">
            {e.repsText !== null && (
              <p className="flex flex-col [overflow-wrap:anywhere]">
                <span className={CAPTION}>Reps</span>
                <span className={FIGURE}>{rangeFigure(e.repsText)}</span>
                {cell !== null && (
                  <span className="font-mono text-16 text-text-muted">
                    {cell.caption === "RPE" ? `RPE ${cell.value}` : `${cell.value}${cell.unit ?? ""}`}
                  </span>
                )}
              </p>
            )}
            <div className="flex min-w-0 flex-col gap-1">
              {kg !== null && (
                // fokus-kg.md §1: today's kg; the visual copy is aria-hidden, §4's sentence is said once.
                <p className="flex flex-col [overflow-wrap:anywhere]">
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
              {lastWeek !== null && (
                <p className="text-14 text-text-muted">
                  {lastWeek.kind === "kg" ? (
                    <>
                      Sidste uge <span className="font-mono text-16 font-medium tabular-nums">{lastWeek.text}</span>
                    </>
                  ) : (
                    lastWeek.text
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
        {kg?.basis === "e1rm" && adjustment !== null && (
          <p className="mt-3 text-16 text-text-muted">
            {adjustment.signed !== "" && <span className="font-medium text-text">{adjustment.signed}</span>}
            {adjustment.rest}
          </p>
        )}
        {/* F4: Spring over acts on this set, so it sits inside its card, bottom right. */}
        <p className="mt-4 flex justify-end">
          <button type="button" onClick={onSkip} className={SKIP_BUTTON}>
            Spring over
          </button>
        </p>
      </section>
      {feel !== null && (
        <div className="mt-1">
          <FeelBlock set={feel.set} logged={feel.logged} named={feel.named} onTap={onTap} />
        </div>
      )}
      <DoneButton primary={primary} onClick={onDone} visible={label.visible} spoken={label.spoken} />
    </div>
  );
}

/** fokus-pause.md §2 and §4 (Variants A and C): the warm-up, after the feel of the set before. */
function WarmupView({
  view,
  mainLifts,
  week,
  primary,
  onWarmupEnd,
  onTap,
}: {
  readonly view: Extract<FokusView, { kind: "warmup" }>;
  readonly mainLifts: readonly string[] | null;
  readonly week: number;
  readonly primary: PrimaryRef;
  readonly onWarmupEnd: () => void;
  readonly onTap: FeelTap;
}) {
  const setOne = view.shown;
  if (setOne === null || view.label === null) return null; // the order and the rows come from the same sets: not reached
  const mainLift = isMainLift(setOne.exercise, mainLifts);
  const feel = view.feel;
  // view.since null: no recorded start (§2.2), a static 0:00.
  const since = view.since;
  return (
    <div className={`flex flex-1 flex-col ${FADE_IN}`}>
      {feel !== null && (
        <div className="mt-2">
          <FeelBlock set={feel.set} logged={feel.logged} named onTap={onTap} />
        </div>
      )}
      <div className={feel !== null ? "mt-10" : "mt-4"}>
        <WarmupCard since={since} exercise={setOne.exercise} mainLift={mainLift} />
      </div>
      <NextSetCard next={setOne} week={week} inWarmup afterTimer={rampState(setOne.exercise, mainLift) === "hidden"} />
      <DoneButton
        primary={primary}
        onClick={onWarmupEnd}
        visible={view.label.visible}
        spoken={view.label.spoken}
      />
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
  onTap,
  footer,
}: {
  readonly session: number;
  readonly card: FinishCard;
  readonly marks: Signature;
  readonly primary: PrimaryRef;
  readonly flush: () => Promise<void>;
  readonly feel: FokusView["feel"];
  readonly onTap: FeelTap;
  /** "Tid brugt …": shown only here since round 3. */
  readonly footer: ReactNode;
}) {
  return (
    <div className={`flex flex-1 flex-col ${FADE_IN}`}>
      {feel !== null && (
        <div className="mt-2">
          <FeelBlock set={feel.set} logged={feel.logged} named onTap={onTap} />
        </div>
      )}
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
        <HomeLink ref={primary} flush={flush} className={DARK_BOX}>
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
