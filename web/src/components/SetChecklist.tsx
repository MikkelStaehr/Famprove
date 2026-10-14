"use client";

import { type FocusEvent, useEffect, useId, useRef, useState } from "react";

import type { SetState } from "@/lib/set-taps";
import {
  adjustmentBrackets,
  compactPrescription,
  type ExerciseRunView,
  exerciseRuns,
  lastWeekText,
  runCountText,
  type SetDot,
  type SetGroupView,
  type SetLineView,
  setStatus,
  spokenSetLine,
  suggestionView,
} from "@/lib/training-view";

import { Icon } from "./icons";
import { SECONDARY } from "./instrument";
import { useSession } from "./SetLogProvider";
import { WarningLine } from "./WarningLine";

/**
 * Træning's strength list per set (spec traening.md §3.3; Instrument look instrument-traening.md
 * §1–§2: set ticks read down the list as a vertical barcode, NÆSTE as an ink edge + caption). One group per sheet row with the values its sets
 * share, then one <label> + native checkbox per set: the whole line is the target and Space
 * toggles it. Each line's accessible name is one sr-only sentence; the visual copy is aria-hidden.
 * The state comes from the set log (useSetLog), so ticks survive a reload.
 */

/** The Sæt card's count, right of its title: "7 / 19" (7 in --text 500, "/ 19" muted), plus "2 sprunget over". Not live. */
export function SetCount() {
  const { done, skipped, total } = useSession().view.progress;
  return (
    <div className="flex flex-col items-end">
      <p className="font-mono text-14 text-text-muted tabular-nums">
        <span className="sr-only">
          {done} af {total} sæt udført
        </span>
        <span aria-hidden="true">
          <span className="font-medium text-text">{done}</span> / {total}
        </span>
      </p>
      {skipped > 0 && <p className="font-mono text-12 text-text-muted tabular-nums">{skipped} sprunget over</p>}
    </div>
  );
}

/**
 * One collapsible row per exercise (user 2026-10-14, slice exercise-collapse): an exercise is its
 * run of same-named sheet rows. Expanded = the user's toggle, else whether it holds the NÆSTE set,
 * so after its last set the next exercise opens unless the user chose otherwise.
 * When ticking the last set auto-collapses an exercise that held focus, the ticked checkbox is
 * hidden; focus moves to the next exercise's header (or, for the last exercise, its own header),
 * so keyboard and screen-reader users keep their place.
 */
export function SetChecklist() {
  const { session, view } = useSession();
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const runs = exerciseRuns(view.groups);
  const expandedByKey = new Map(runs.map((run) => [run.key, toggled.get(run.key) ?? run.isNext] as const));
  const items = useRef(new Map<string, HTMLLIElement>());
  const headers = useRef(new Map<string, HTMLButtonElement>());
  const focusedRun = useRef<string | null>(null); // the exercise focus was last inside
  const wasExpanded = useRef<ReadonlyMap<string, boolean>>(new Map());

  useEffect(() => {
    const before = wasExpanded.current;
    wasExpanded.current = expandedByKey;
    const key = focusedRun.current;
    if (key === null || before.get(key) !== true || expandedByKey.get(key) !== false || toggled.has(key)) return;
    // Only when focus is still in the collapsed exercise (or was dropped to the body by the hide).
    const active = document.activeElement;
    const item = items.current.get(key);
    if (active !== null && active !== document.body && !(item?.contains(active) ?? false)) return;
    const at = runs.findIndex((r) => r.key === key);
    const target = headers.current.get(runs[at + 1]?.key ?? key);
    target?.focus();
  });

  const onBlur = (key: string) => (e: FocusEvent<HTMLLIElement>) => {
    // Focus moving to another element outside this exercise; a hide (relatedTarget null) keeps the key.
    if (e.relatedTarget !== null && !e.currentTarget.contains(e.relatedTarget) && focusedRun.current === key) {
      focusedRun.current = null;
    }
  };

  return (
    <ol aria-label="Øvelser" className="flex flex-col">
      {runs.map((run, i) => {
        const expanded = expandedByKey.get(run.key) ?? false;
        return (
          <li
            key={run.key}
            ref={(el) => {
              if (el === null) items.current.delete(run.key);
              else items.current.set(run.key, el);
            }}
            onFocus={() => {
              focusedRun.current = run.key;
            }}
            onBlur={onBlur(run.key)}
            className={`relative${i === 0 ? "" : " border-t border-border"}`}
          >
            {/* The NÆSTE exercise: a 2px --text bar on its left edge at x −12px, full height (§2.5). */}
            {run.isNext && <span aria-hidden="true" data-next-edge="true" className="absolute inset-y-0 -left-3 w-0.5 bg-text" />}
            <ExerciseRun
              run={run}
              week={session.week}
              expanded={expanded}
              onToggle={() => setToggled((m) => new Map(m).set(run.key, !expanded))}
              headerRef={(el) => {
                if (el === null) headers.current.delete(run.key);
                else headers.current.set(run.key, el);
              }}
            />
          </li>
        );
      })}
    </ol>
  );
}

function ExerciseRun({
  run,
  week,
  expanded,
  onToggle,
  headerRef,
}: {
  readonly run: ExerciseRunView;
  readonly week: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly headerRef: (el: HTMLButtonElement | null) => void;
}) {
  const regionId = useId();
  const e = run.focus;
  const suggestion = suggestionView(e);
  const brackets = adjustmentBrackets(e, "long");
  const lastWeek = lastWeekText(e, week);
  const muted = run.closed ? "text-text-muted" : "text-text";
  const multi = run.groups.length > 1;
  return (
    <div className="flex flex-col">
      <button
        ref={headerRef}
        type="button"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={onToggle}
        className="flex min-h-11 w-full cursor-pointer flex-col gap-1.5 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span className="flex w-full items-start justify-between gap-3">
          <span className={`min-w-0 font-sans text-16 font-medium break-words ${muted}`}>
            {run.name}
            <span className="sr-only">, {runCountText(run)}</span>
          </span>
          <span aria-hidden="true" className="flex shrink-0 items-center gap-2.5 pt-1">
            <SetDots dots={run.dots} />
            <Icon
              name="chevron-down"
              size={16}
              className={`text-text-muted transition-transform duration-[120ms] motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
            />
          </span>
        </span>
        {run.prescription !== "" && (
          <span aria-hidden="true" className={`block min-w-0 font-mono text-14 tabular-nums break-words ${muted}`}>
            <KeepRanges text={run.prescription} />
          </span>
        )}
        {(suggestion.kg !== null || lastWeek !== undefined) && (
          <span aria-hidden="true" className={`flex min-w-0 flex-wrap gap-x-6 gap-y-1 ${run.closed ? "text-text-muted" : ""}`}>
            {suggestion.kg !== null && (
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-mono text-12 text-text-muted uppercase">Forslag</span>
                <span className="font-mono text-16 tabular-nums">
                  <span className="whitespace-nowrap">{suggestion.kg}</span>
                  {brackets !== null && <span className="font-sans text-13 text-text-muted"> {brackets}</span>}
                </span>
              </span>
            )}
            {lastWeek !== undefined &&
              (lastWeek === null ? (
                <span className="min-w-0 self-end text-14 text-text-muted">Intet logget sidste uge</span>
              ) : (
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-mono text-12 text-text-muted uppercase">Sidste uge</span>
                  <span className="font-mono text-16 tabular-nums">{lastWeek}</span>
                </span>
              ))}
          </span>
        )}
      </button>
      <div id={regionId} hidden={!expanded} className="pb-2">
        {run.groups.map((group) => {
          const caption = multi ? compactPrescription(group.exercise) : null;
          return (
            <div key={group.exercise.key} className="flex flex-col">
              {caption !== null && (
                <p aria-hidden="true" className="pt-2 pb-1 font-mono text-12 text-text-muted tabular-nums">
                  <KeepRanges text={caption} />
                </p>
              )}
              <ol aria-label="Sæt" className="flex flex-col">
                {group.sets.map((line) => (
                  <li key={`${line.ref.row}#${line.ref.set}`}>
                    <SetLine group={group} line={line} week={week} />
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One 8px dot per set (aria-hidden; the button's sr text says the count): done = a filled --text
 * disc, open = a 1px --text-muted ring, skipped = that ring with a short diagonal stroke (shape,
 * not colour), the NÆSTE set = a 1.5px --text ring.
 */
function SetDots({ dots }: { readonly dots: readonly SetDot[] }) {
  return (
    <span className="flex items-center gap-1">
      {dots.map((d) =>
        d.state === "done" ? (
          <span key={d.key} data-dot="done" className="block size-2 rounded-pill bg-text" />
        ) : (
          <span
            key={d.key}
            data-dot={d.next ? "next" : d.state}
            className={`relative block size-2 overflow-hidden rounded-pill ${
              d.next ? "border-[1.5px] border-text" : "border border-text-muted"
            }`}
          >
            {d.state === "skipped" && (
              <span className="absolute top-1/2 left-1/2 block h-px w-2.5 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-text-muted" />
            )}
          </span>
        ),
      )}
    </span>
  );
}

function SetLine({ group, line, week }: { readonly group: SetGroupView; readonly line: SetLineView; readonly week: number }) {
  const { setLog } = useSession();
  const status = setStatus(line);
  const muted = line.state !== "open" ? "text-text-muted" : "text-text";
  // open -> done; done -> open (undo); skipped -> done.
  const toggle = () => setLog.tap(line.state === "done" ? "undo" : "done", line.ref);
  return (
    // A ListRow: 1px --border top, ≥ 52px; the whole row is the target, Space toggles the native checkbox.
    <label
      className={`grid min-h-13 cursor-pointer grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-2 border-t border-border has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus ${muted}`}
    >
      <input type="checkbox" className="sr-only" checked={line.state === "done"} onChange={toggle} />
      <span className="sr-only">{spokenSetLine(group.exercise, week, line)}</span>
      <span aria-hidden="true" className="flex size-11 items-center justify-center">
        <SetTick state={line.state} />
      </span>
      <span aria-hidden="true" className="min-w-0 font-sans text-15">
        Sæt <span className="font-mono">{line.n}</span> af <span className="font-mono">{line.of}</span>
      </span>
      <span aria-hidden="true" className="justify-self-end text-right">
        {line.next ? (
          <span className="rounded-pill border border-shade-2 px-2 py-0.75 font-mono text-11 font-medium text-text uppercase">
            Næste
          </span>
        ) : status !== null ? (
          <span className="font-mono text-12 text-text-muted tabular-nums">{status}</span>
        ) : null}
      </span>
    </label>
  );
}

/** Save failed (spec §5 (s)) and the dev-switch note, under the list. */
export function SaveNotes() {
  const { setLog, devSwitches } = useSession();
  return (
    <>
      {setLog.unsaved > 0 && (
        <WarningLine>
          {setLog.unsaved === 1 ? "1 sæt er ikke gemt." : `${setLog.unsaved} sæt er ikke gemt.`} De står her, men
          forsvinder, hvis siden genindlæses.{" "}
          <button type="button" onClick={setLog.retry} className={`mt-2 flex ${SECONDARY}`}>
            Gem igen
          </button>
        </WarningLine>
      )}
      {setLog.rejected && <WarningLine>Et tryk blev afvist. Genindlæs siden.</WarningLine>}
      {(devSwitches || setLog.dev) && <p className="text-14 text-text-muted">Testvisning: sæt gemmes ikke.</p>}
    </>
  );
}

const RANGE = /(\d+(?:[.,]\d+)?(?:\s+-\s+|–)\d+(?:[.,]\d+)?)/;

/**
 * The text with each range ("8–12", or "8 - 12" as written) kept on one line: at large text sizes
 * a break inside a range would leave "8–" / "12", which reads like "-12".
 */
function KeepRanges({ text }: { readonly text: string }) {
  // split() with a capturing group puts the ranges at the odd indexes.
  return text.split(RANGE).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * The set tick (reset-traening.md §2.5): a 24px circle in the 44 × 44 target. Open = a 1.5px
 * --shade-2 ring (5.93:1); done = an --inverse-bg disc with a 1.5px --inverse-text check; skipped =
 * the ring with a 1.5px dash. Shape, not colour, tells them apart. No motion.
 */
function SetTick({ state }: { readonly state: SetState }) {
  if (state === "done") {
    return (
      <span data-tick="done" className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-inverse-bg">
        <Icon name="check" size={16} className="text-inverse-text" />
      </span>
    );
  }
  return (
    <span data-tick={state} className="flex size-6 shrink-0 items-center justify-center rounded-pill border-[1.5px] border-shade-2">
      {state === "skipped" && <span className="block h-[1.5px] w-2.5 bg-shade-2" />}
    </span>
  );
}
