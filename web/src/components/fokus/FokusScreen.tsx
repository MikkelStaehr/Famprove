"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { useSetLog } from "@/components/useSetLog";
import { HomeLink } from "./HomeLink";
import { WarningLine } from "@/components/WarningLine";
import {
  doneSentence,
  exerciseName,
  FINISHED_SENTENCE,
  finishCard,
  type FokusExercise,
  fokusView,
  kgBlock,
  lastTapText,
  lastWeekLine,
  nextSetSummary,
  repsWord,
  type SetInContext,
  setInContext,
  setSentence,
  setTitle,
  skippedText,
  skipSentence,
  undoSentence,
  unsavedText,
} from "@/lib/fokus-view";
import { CAPPED_WORD } from "@/lib/training-view";
import {
  applyTap,
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
import { RestTimer } from "./RestTimer";
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
};

const PRESS =
  "transition-transform duration-120 ease-out active:scale-97 motion-reduce:transition-none motion-reduce:active:scale-100";
const PRIMARY_INK = `flex min-h-16 w-full items-center justify-center gap-2 rounded-pill bg-text px-4 font-display text-32 font-extrabold text-bg uppercase italic ${PRESS}`;
const OUTLINE_PILL = "rounded-pill border-2 border-text-muted text-16 font-semibold text-text";
const IN_SLAB_FOCUS = "focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-slab-mark";
const FADE_IN = "transition-opacity duration-180 ease-out starting:opacity-0 motion-reduce:transition-none";

/**
 * `/fokus` (spec traening.md §4): one set at a time, rebuilt from the set log on every load.
 * Three view states with one primary action each: set (Udført), rest (Til næste sæt), finished
 * (Tilbage til Træning). Taps go through useSetLog (optimistic, saved in order). "Til næste
 * sæt" writes nothing: it only dismisses the current rest.
 */
export function FokusScreen({ session, date, staleNote, devSwitches, enteredFromTraening }: FokusScreenProps) {
  const { log, tap, unsaved, retry, rejected, dev, flush } = useSetLog(session.log, session.order, date, session.session);
  const [dismissed, setDismissed] = useState<string | null>(() =>
    enteredFromTraening ? restStart(new Map(session.log.map((l) => [setKey(l), l]))) : null,
  );
  const [announcement, setAnnouncement] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const primary = useRef<HTMLButtonElement & HTMLAnchorElement>(null);

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
    after(following === null ? FINISHED_SENTENCE : doneSentence(current));
  };

  const onSkip = (current: SetInContext) => {
    const following = nextOpen(session.order, log, current.ref);
    const next = following === null ? null : at(following);
    tap("skip", current.ref);
    after(`${skipSentence(current)} ${next === null ? FINISHED_SENTENCE : setSentence(next, session.week)}`);
  };

  const onNext = (since: string, next: SetInContext | null) => {
    setDismissed(since);
    after(next === null ? "" : setSentence(next, session.week));
  };

  const onUndo = () => {
    if (latest === null) return;
    const undone = at(latest.ref);
    // The reopened set shows in the set view, even if an earlier done tap is now the latest.
    setDismissed(restStart(applyTap(session.order, log, "undo", latest.ref, new Date().toISOString())));
    tap("undo", latest.ref);
    after(undone === null ? "" : undoSentence(undone));
  };

  const lastLine = latest === null ? null : lastTapText(session.exercises, latest);
  const skipped = skippedText(p);

  return (
    <div className="flex flex-col">
      <h1 className="sr-only">Fokus</h1>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {/* Top bar: fixed in layout, so the card never jumps (§4.1). */}
      <div className="flex items-center justify-between gap-3">
        <HomeLink flush={flush} className={`inline-flex min-h-11 shrink-0 items-center px-4 ${OUTLINE_PILL}`}>
          Afslut
        </HomeLink>
        <p className="flex flex-wrap items-baseline justify-end gap-x-1 text-right tabular-nums">
          <span>
            <span className="font-display text-24 font-extrabold italic">{p.done}</span>
            <span className="text-16 font-semibold"> af {p.total} sæt udført</span>
          </span>
          {skipped !== null && <span className="text-16 font-semibold">{skipped}</span>}
        </p>
      </div>
      <div className="mt-3">
        <FokusProgress order={session.order} stateOf={(ref) => stateOf(log.get(setKey(ref)))} />
      </div>
      <div className="mt-2 flex min-h-11 flex-col justify-center">
        {staleNote !== null && <WarningLine>{staleNote}</WarningLine>}
        {unsaved > 0 && (
          <WarningLine>
            {unsavedText(unsaved)} De står her, men forsvinder, hvis siden genindlæses.{" "}
            <button
              type="button"
              onClick={retry}
              className="min-h-11 text-16 font-semibold text-text underline decoration-1 underline-offset-3"
            >
              Gem igen
            </button>
          </WarningLine>
        )}
        {rejected && <WarningLine>Et tryk blev afvist. Genindlæs siden.</WarningLine>}
        {lastLine !== null && (
          <p className="flex flex-wrap items-center gap-x-2 text-16 text-text-muted">
            <span>
              <KeepClock text={lastLine} />
            </span>
            <button
              type="button"
              onClick={onUndo}
              className="min-h-11 px-2 font-semibold text-text underline decoration-1 underline-offset-3"
            >
              Fortryd
            </button>
          </p>
        )}
      </div>

      {view.kind === "set" && (
        <SetView
          key={`set-${setKey(view.current)}`}
          current={at(view.current)}
          week={session.week}
          primary={primary}
          onDone={onDone}
          onSkip={onSkip}
        />
      )}
      {view.kind === "rest" && (
        <RestView
          key={`rest-${view.since}`}
          since={view.since}
          next={at(view.next)}
          primary={primary}
          onNext={onNext}
        />
      )}
      {view.kind === "finished" && (
        <FinishedView session={session.session} card={finishCard(session.session, p, log)} primary={primary} flush={flush} />
      )}

      {(devSwitches || dev) && <p className="mt-4 text-14 text-text-muted">Testvisning: sæt gemmes ikke.</p>}
    </div>
  );
}

type PrimaryRef = RefObject<(HTMLButtonElement & HTMLAnchorElement) | null>;

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-7 shrink-0" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
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

/** §4.2: the current set on a full slab card, Udført inside it, Spring over below. */
function SetView({
  current,
  week,
  primary,
  onDone,
  onSkip,
}: {
  readonly current: SetInContext | null;
  readonly week: number;
  readonly primary: PrimaryRef;
  readonly onDone: (s: SetInContext) => void;
  readonly onSkip: (s: SetInContext) => void;
}) {
  if (current === null) return null; // the order and the rows come from the same sets: not reached
  const e = current.exercise;
  const kg = kgBlock(e);
  const lastWeek = lastWeekLine(e, week);
  const word = e.repsText === null ? null : repsWord(e.repsText);
  return (
    <div className={`flex flex-col ${FADE_IN}`}>
      <section aria-labelledby="fokus-set" className="mt-2 flex flex-col rounded-card bg-slab px-4 pt-6 pb-4 text-on-slab">
        <h2 id="fokus-set" className="font-display text-32 font-extrabold uppercase italic [overflow-wrap:anywhere]">
          {exerciseName(e)}
        </h2>
        <p className="mt-1 text-20 font-bold">{setTitle(current)}</p>

        {(e.repsText !== null || e.prescribed !== null) && (
          <p className="mt-4 flex flex-wrap items-baseline gap-x-4 font-display font-bold tabular-nums">
            {e.repsText !== null && (
              <span className="[overflow-wrap:anywhere]">
                <span className="text-56">{e.repsText}</span>
                {word !== null && <span className="text-32"> {word}</span>}
              </span>
            )}
            {e.prescribed !== null && <span className="text-32">{e.prescribed}</span>}
          </p>
        )}

        <div className="mt-4 flex flex-col">
          <p className="text-14 font-bold tracking-[0.04em] text-on-slab-muted uppercase">{kg.label}</p>
          {kg.kind === "suggestion" && (
            <p className="font-display font-extrabold tabular-nums italic [overflow-wrap:anywhere]">
              <span className="text-56">{kg.figure}</span>
              <span className="text-32">{" "}kg</span>
            </p>
          )}
          {kg.kind === "suggestion" && kg.capped && (
            <p className="text-16 text-on-slab-muted">{CAPPED_WORD} i forhold til sidste uge</p>
          )}
          {kg.kind === "last_week" && (
            <>
              <p className="font-display font-bold tabular-nums [overflow-wrap:anywhere]">
                <span className="text-56">{kg.figure}</span>
                {kg.unit !== null && <span className="text-32">{" "}kg</span>}
              </p>
              {kg.reason !== null && <p className="text-16 text-on-slab-muted">{kg.reason}</p>}
            </>
          )}
          {kg.kind === "none" && (
            <>
              <p className="font-display text-32 font-bold text-on-slab-muted">{kg.text}</p>
              {kg.reason !== null && <p className="text-16 text-on-slab-muted">{kg.reason}</p>}
            </>
          )}
        </div>

        {lastWeek !== null && (
          <p className="mt-1 flex flex-wrap gap-x-2 text-20">
            {lastWeek.kind === "kg" ? (
              <>
                <span className="text-on-slab-muted">Sidste uge</span>
                <span className="font-semibold">{lastWeek.text}</span>
              </>
            ) : (
              <span className="text-on-slab-muted">{lastWeek.text}</span>
            )}
          </p>
        )}

        <button
          ref={primary}
          type="button"
          onClick={() => onDone(current)}
          className={`mt-6 flex min-h-16 w-full items-center justify-center gap-2 rounded-pill bg-slab-mark px-4 font-display text-32 font-extrabold text-slab uppercase italic ${PRESS} ${IN_SLAB_FOCUS}`}
        >
          <CheckIcon />
          Udført
        </button>
      </section>

      <button
        type="button"
        onClick={() => onSkip(current)}
        className={`mt-4 min-h-12 self-center px-6 ${OUTLINE_PILL} ${PRESS}`}
      >
        Spring over
      </button>
    </div>
  );
}

/** §4.3: the count-up rest, the next set in a small slab, Til næste sæt (no write). */
function RestView({
  since,
  next,
  primary,
  onNext,
}: {
  readonly since: string;
  readonly next: SetInContext | null;
  readonly primary: PrimaryRef;
  readonly onNext: (since: string, next: SetInContext | null) => void;
}) {
  const summary = next === null ? null : nextSetSummary(next);
  return (
    <section
      aria-labelledby="fokus-rest"
      className={`mt-2 flex flex-col rounded-card bg-surface px-4 pt-6 pb-4 shadow-card ${FADE_IN}`}
    >
      <h2 id="fokus-rest" className="text-14 font-bold tracking-[0.04em] text-text-muted uppercase">
        Pause
      </h2>
      <RestTimer since={since} />
      {summary !== null && (
        <div className="mt-4 flex flex-col rounded-control bg-slab p-3 text-on-slab">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="rounded-mark bg-slab-mark px-2 py-0.5 text-14 font-bold tracking-[0.08em] text-slab uppercase">
              Næste
            </span>
            <span className="text-20 font-bold">{summary.title}</span>
          </p>
          <p className="text-16 font-medium tabular-nums">{summary.line}</p>
        </div>
      )}
      <button ref={primary} type="button" onClick={() => onNext(since, next)} className={`mt-6 ${PRIMARY_INK}`}>
        Til næste sæt
        <ArrowIcon />
      </button>
    </section>
  );
}

/** §4.4: the finish card and the way back. */
function FinishedView({
  session,
  card,
  primary,
  flush,
}: {
  readonly session: number;
  readonly card: ReturnType<typeof finishCard>;
  readonly primary: PrimaryRef;
  readonly flush: () => Promise<void>;
}) {
  return (
    <div className={`flex flex-col ${FADE_IN}`}>
      <section
        aria-labelledby={`fokus-finished-${session}`}
        className="mt-2 flex flex-col rounded-card bg-slab px-4 pt-6 pb-4 text-on-slab"
      >
        <h2
          id={`fokus-finished-${session}`}
          className="font-display text-44 font-extrabold tracking-[-0.01em] uppercase italic"
        >
          {card.title}
        </h2>
        <p className="mt-3 text-20 font-bold tabular-nums">{card.counts}</p>
        {card.times !== null && <p className="mt-1 text-16 tabular-nums">{card.times}</p>}
        <p className="mt-3 text-20 font-bold">Husk at logge kg i arket.</p>
      </section>
      <HomeLink ref={primary} flush={flush} className={`mt-6 ${PRIMARY_INK}`}>
        Tilbage til Træning
      </HomeLink>
    </div>
  );
}

const CLOCK = /(kl\. \d{1,2}\.\d{2})/;

/** "kl. 18.42" kept on one line: at 200% text a break between "kl." and the time reads badly. */
function KeepClock({ text }: { readonly text: string }) {
  // split() with a capturing group puts the times at the odd indexes.
  return text.split(CLOCK).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
