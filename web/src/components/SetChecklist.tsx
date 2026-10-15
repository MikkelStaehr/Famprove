"use client";

import { type ReactNode, useId, useState } from "react";

import { RollingNumber } from "@/components/motion/RollingNumber";

import { type FreshTicks, tickAnimates } from "@/lib/fresh-ticks";
import { setKey, type SetState } from "@/lib/set-taps";
import { refusedText, type SeamSave, type SeamState, type SeamView, slotKey } from "@/lib/superset-view";
import {
  adjustmentBrackets,
  compactPrescription,
  type ExerciseRunView,
  exerciseRuns,
  lastWeekItem,
  runCountText,
  type SetDot,
  type SetGroupView,
  type SetLineView,
  setStatus,
  spokenSetLine,
  todayKgView,
} from "@/lib/training-view";

import { OUTLINED } from "./fokus/Instrument";
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
          <span className="font-medium text-text"><RollingNumber text={String(done)} /></span> / {total}
        </span>
      </p>
      {skipped > 0 && <p className="font-mono text-12 text-text-muted tabular-nums">{skipped} sprunget over</p>}
    </div>
  );
}

/**
 * One collapsible row per exercise (user 2026-10-14, slice exercise-collapse): an exercise is its
 * run of same-named sheet rows. Every exercise starts collapsed (review round §9): expanded = the
 * user's toggle only, so nothing opens or collapses on its own and focus stays where the user put it.
 */
export function SetChecklist() {
  const { session, view, seams } = useSession();
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const runs = exerciseRuns(view.groups);
  const rowOf = (run: ExerciseRunView) => run.groups[0].exercise.row;
  const seamAfter = new Map(seams.views.map((v) => [v.rowA, v]));

  const item = (run: ExerciseRunView, grouped: boolean) => {
    const expanded = toggled.get(run.key) ?? false;
    return (
      <div className="relative">
        {/* The NÆSTE exercise: a 2px --text bar at the list's x −12px, full height (§2.5); in a superset group the rail sits there, so it moves out with the indent. */}
        {run.isNext && (
          <span aria-hidden="true" data-next-edge="true" className={`absolute inset-y-0 w-0.5 bg-text ${grouped ? "-left-6" : "-left-3"}`} />
        )}
        <ExerciseRun
          run={run}
          week={session.week}
          expanded={expanded}
          onToggle={() => setToggled((m) => new Map(m).set(run.key, !expanded))}
        />
      </div>
    );
  };

  const items: ReactNode[] = [];
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    const seam = seamAfter.get(rowOf(run));
    const partner = runs[i + 1];
    const before = i === 0 ? null : seamAfter.get(rowOf(runs[i - 1]));
    const grouped = seam !== undefined && partner !== undefined && seam.rowB === rowOf(partner) && seamPaired(seam.state);
    if (grouped) {
      // S4: the pair as one block, a 2px --text rail from A's top to B's bottom, rows indented 12px.
      items.push(
        <li
          key={run.key}
          role="group"
          aria-label={`Superset: ${seam.both}`}
          className={`relative pl-3${i === 0 ? "" : " border-t border-border"}`}
        >
          <span
            aria-hidden="true"
            data-superset-rail="true"
            className={`absolute inset-y-0 left-0 w-0.5 bg-text${seams.drawn.has(slotKey(seam)) ? " seam-rail-draw" : ""}`}
          />
          {item(run, true)}
          <Seam v={seam} />
          {item(partner, true)}
        </li>,
      );
      i += 1;
      continue;
    }
    // R1: an unpaired seam sits on the boundary above B, in place of the row divider.
    const seamAbove = before !== undefined && before !== null && before.rowB === rowOf(run) && hasSeam(before, seams.saves) ? before : null;
    items.push(
      <li key={run.key} className={`relative${i === 0 || seamAbove !== null ? "" : " border-t border-border"}`}>
        {seamAbove !== null && <Seam v={seamAbove} />}
        {item(run, false)}
      </li>,
    );
  }

  return (
    <>
      <p role="status" className="sr-only">
        {seams.status}
      </p>
      <ol aria-label="Øvelser" className="flex flex-col">
        {items}
      </ol>
    </>
  );
}

function seamPaired(state: SeamState): boolean {
  return state === "paired" || state === "suggested" || state === "locked";
}

function hasSeam(v: SeamView, saves: ReadonlyMap<string, SeamSave>): boolean {
  const status = saves.get(slotKey(v))?.status;
  return v.state !== "none" || status === "failed" || status === "refused";
}

/**
 * The seam between two runs (supersets.md S1–S3, S7–S9): hairlines left and right, the control
 * centred. A dark compact toggle (32px visible, 44px hit via ::before), or the static locked text.
 */
function Seam({ v }: { readonly v: SeamView }) {
  const { seams } = useSession();
  const save = seams.saves.get(slotKey(v));
  const on = seamPaired(v.state);
  return (
    <div className="flex flex-col pb-1">
      {v.state !== "none" && (
        <div data-seam={v.state} className="flex min-h-11 items-center gap-3">
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          {v.state === "locked" ? (
            <p className="flex items-center gap-2 font-mono text-13 text-text-muted uppercase">
              <Icon name="arrow-left-right" size={18} />
              <span aria-hidden="true">Superset · låst</span>
              <span className="sr-only">Superset, låst, fordi {v.started} er gået i gang.</span>
            </p>
          ) : (
            <>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`Superset: ${v.both}`}
                onClick={() => seams.toggle(v, !on)}
                className={`relative inline-flex h-8 shrink-0 items-center gap-2 px-3 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${OUTLINED.replace("bg-card", on ? "bg-raised" : "bg-card")}`}
              >
                <Icon name={on ? "check" : "arrow-left-right"} size={18} />
                Superset
              </button>
              {v.state === "suggested" && <span className="shrink-0 font-sans text-13 text-text-muted">Som sidst</span>}
            </>
          )}
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
      )}
      {save?.status === "failed" && (
        <WarningLine>
          Superset-valget er ikke gemt. Det står her, men forsvinder, hvis siden genindlæses.{" "}
          <button type="button" onClick={() => seams.toggle(v, save.override ?? on)} className={`mt-2 flex ${SECONDARY}`}>
            Gem igen
          </button>
        </WarningLine>
      )}
      {save?.status === "refused" && <WarningLine>{refusedText(v)}</WarningLine>}
    </div>
  );
}

function ExerciseRun({
  run,
  week,
  expanded,
  onToggle,
}: {
  readonly run: ExerciseRunView;
  readonly week: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const regionId = useId();
  const { fresh } = useSession().setLog;
  const e = run.focus;
  const today = todayKgView(e);
  const brackets = today?.basis === "e1rm" ? adjustmentBrackets(e, "long") : null;
  const lastWeek = lastWeekItem(e, week);
  const muted = run.closed ? "text-text-muted" : "text-text";
  const multi = run.groups.length > 1;
  return (
    <div className="flex flex-col">
      {/* Collapsed (review round §9): the name, one dot per set and the chevron. Nothing else. */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={onToggle}
        className={`flex min-h-11 w-full cursor-pointer justify-between gap-3 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
          run.variant === null ? "items-center" : "items-start"
        }`}
      >
        {run.variant === null ? (
          <span className={`min-w-0 font-sans text-16 font-medium break-words ${muted}`}>
            {run.name}
            <span className="sr-only">, {runCountText(run)}</span>
          </span>
        ) : (
          // variants.md §1–§2: the variant as the title, the sheet's exercise muted under it (4px).
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="sr-only">
              {run.variant}, {run.name}, {runCountText(run)}
            </span>
            <span aria-hidden="true" className={`font-sans text-16 font-medium break-words text-balance ${muted}`}>
              {run.variant}
            </span>
            <span aria-hidden="true" className="font-sans text-13 break-words text-balance text-text-muted">
              {run.name}
            </span>
          </span>
        )}
        {/* With a variant the dots and chevron centre on the title's first line (text-16 at line-height 1.35). */}
        <span aria-hidden="true" className={`flex shrink-0 items-center gap-2.5${run.variant === null ? "" : " h-[1.35rem]"}`}>
          <SetDots dots={run.dots} fresh={fresh} />
          <Icon
            name="chevron-down"
            size={16}
            className={`text-text-muted transition-transform duration-[350ms] ease-(--ease-ember) motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {/* Expanded: the prescription, today's kg (fokus-kg.md §3), SIDSTE UGE, then the set rows.
          The visual copy is aria-hidden: each set row's sr sentence says the same values.
          Unfold (Part B "Motion"): grid rows 0fr <-> 1fr over 380 ms on the ember ease; a mount never
          transitions, so the first paint is still. Closed = inert at once (out of the tab order and
          the accessibility tree), never display:none, so a fresh tick's draw doesn't replay on reopen.
          The inner -mx-1 px-1 keeps the set rows' 4px focus ring inside the clip. */}
      <div
        id={regionId}
        inert={!expanded}
        data-expanded={expanded}
        className={`grid transition-[grid-template-rows] duration-[380ms] ease-(--ease-ember) motion-reduce:transition-none ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="-mx-1 min-h-0 overflow-hidden px-1">
          <div className="pb-2">
            {run.prescription !== "" && (
              <p aria-hidden="true" className={`min-w-0 pb-1.5 font-mono text-14 tabular-nums break-words ${muted}`}>
                <KeepRanges text={run.prescription} />
              </p>
            )}
            {(today !== null || lastWeek !== null) && (
              <div aria-hidden="true" className={`flex min-w-0 flex-wrap gap-x-6 gap-y-1 pb-3 ${run.closed ? "text-text-muted" : ""}`}>
                {today !== null && (
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-12 text-text-muted uppercase">{today.caption}</span>
                    <span className={`font-mono text-16 tabular-nums${today.italic ? " italic" : ""}`}>
                      <span className="whitespace-nowrap">{today.unit === null ? today.figure : `${today.figure} kg`}</span>
                      {brackets !== null && <span className="font-sans text-13 not-italic text-text-muted"> {brackets}</span>}
                    </span>
                  </span>
                )}
                {lastWeek?.kind === "new_variant" && (
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-12 text-text-muted uppercase">Sidste uge</span>
                    <span className="text-14 text-text-muted">{lastWeek.text}</span>
                  </span>
                )}
                {lastWeek?.kind === "kg" && (
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-12 text-text-muted uppercase">Sidste uge</span>
                    <span className="font-mono text-16 tabular-nums">{lastWeek.text}</span>
                  </span>
                )}
              </div>
            )}
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
      </div>
    </div>
  );
}

/**
 * One 8px dot per set (aria-hidden; the button's sr text says the count): done = a filled --text
 * disc, open = a 1px --text-muted ring, skipped = that ring with a short diagonal stroke (shape,
 * not colour), the NÆSTE set = a 1.5px --text ring.
 */
function SetDots({ dots, fresh }: { readonly dots: readonly SetDot[]; readonly fresh: FreshTicks }) {
  return (
    <span className="flex items-center gap-1">
      {dots.map((d) =>
        d.state === "done" ? (
          // A tap's dot pops (.dot-pop, globals.css); a restored one doesn't.
          <span
            key={d.key}
            data-dot="done"
            className={`block size-2 rounded-pill bg-text${tickAnimates(fresh, d.key, d.state) ? " dot-pop" : ""}`}
          />
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
  const draw = tickAnimates(setLog.fresh, setKey(line.ref), line.state);
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
        <SetTick state={line.state} draw={draw} />
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
 * the ring with a 1.5px dash. Shape, not colour, tells them apart. The disc shows at once (T4); a
 * tap's check then draws over 400 ms (`draw`, .tick-draw in globals.css); a restored one is still,
 * and an undo has no reverse (T3). The check is Lucide's path drawn left to right, so the short
 * stroke comes first; pathLength 1 makes the dash a fraction.
 */
function SetTick({ state, draw }: { readonly state: SetState; readonly draw: boolean }) {
  if (state === "done") {
    return (
      <span data-tick="done" className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-inverse-bg">
        <svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          className={`shrink-0 text-inverse-text${draw ? " tick-draw" : ""}`}
        >
          <path pathLength={1} d="M4 12l5 5L20 6" />
        </svg>
      </span>
    );
  }
  return (
    <span data-tick={state} className="flex size-6 shrink-0 items-center justify-center rounded-pill border-[1.5px] border-shade-2">
      {state === "skipped" && <span className="block h-[1.5px] w-2.5 bg-shade-2" />}
    </span>
  );
}
