"use client";

import type { SetState } from "@/lib/set-taps";
import {
  lastWeekText,
  repsText,
  type SetGroupView,
  type SetLineView,
  setStatus,
  spokenSetLine,
  suggestionView,
} from "@/lib/training-view";

import { useSession } from "./SetLogProvider";
import { WarningLine } from "./WarningLine";

/**
 * Træning's strength list per set (spec traening.md §3.3; DESIGN.md › Set groups and tick lines,
 * Part B › NÆSTE slab, Segmented progress). One group per sheet row with the values its sets
 * share, then one <label> + native checkbox per set: the whole line is the target and Space
 * toggles it. Each line's accessible name is one sr-only sentence; the visual copy is aria-hidden.
 * The state comes from the set log (useSetLog), so ticks survive a reload.
 */

/** Card action: "**0** af 24 sæt udført" / "Alle sæt klaret", plus "2 sprunget over". Not live. */
export function SetCount() {
  const { done, skipped, total } = useSession().view.progress;
  return (
    <div className="flex flex-col">
      <p className="text-16 font-semibold tabular-nums">
        {done + skipped === total ? (
          "Alle sæt klaret"
        ) : (
          <>
            <span className="font-display text-24 font-extrabold italic">{done}</span> af {total} sæt udført
          </>
        )}
      </p>
      {skipped > 0 && <p className="text-14 text-text-muted tabular-nums">{skipped} sprunget over</p>}
    </div>
  );
}

const SEGMENT: Readonly<Record<SetState, string>> = {
  done: "bg-slab",
  skipped: "bg-track",
  open: "bg-track",
};

/** One 8px segment per set, by position: done --slab, skipped --track with a dash, open --track. */
export function SetSegments() {
  const { segments } = useSession().view;
  return (
    <div aria-hidden="true" className={`flex ${segments.length > 30 ? "gap-0.5" : "gap-1"}`}>
      {segments.map((state, i) => (
        <span
          key={i}
          className={`flex h-2 flex-1 items-center justify-center rounded-mark transition-colors duration-120 ease-out motion-reduce:transition-none ${SEGMENT[state]}`}
        >
          {state === "skipped" && <span className="h-0.5 w-1/2 rounded-mark bg-text-muted" />}
        </span>
      ))}
    </div>
  );
}

/** The sheet rows in sheet order; runs of the same name share one visible name. */
export function SetChecklist() {
  const { session, view } = useSession();
  return (
    <ol aria-label="Øvelser" className="flex flex-col">
      {view.groups.map((group, i) => (
        <li
          key={group.exercise.key}
          className={i === 0 ? undefined : group.dividerBefore ? "mt-3 border-t border-border pt-3" : "mt-3"}
        >
          <SetGroup group={group} week={session.week} />
        </li>
      ))}
    </ol>
  );
}

function SetGroup({ group, week }: { readonly group: SetGroupView; readonly week: number }) {
  const { exercise: e, slab, closed } = group;
  const reps = repsText(e);
  const suggestion = suggestionView(e);
  const lastWeek = lastWeekText(e, week);
  const label = slab ? "text-on-slab-muted" : "text-text-muted";
  const shared = closed ? "text-text-muted" : "";
  return (
    <div
      className={`grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 transition-colors duration-180 ease-out motion-reduce:transition-none ${
        slab ? "-mx-2 rounded-control bg-slab p-3 text-on-slab" : "px-1"
      }`}
    >
      <p
        className={`col-start-2 min-w-0 text-20 font-bold break-words ${group.showName ? "" : "sr-only"} ${
          group.showName && group.nameMuted ? "text-text-muted" : ""
        }`}
      >
        {e.name}
      </p>
      {(reps !== null || e.prescribed !== null) && (
        <p
          aria-hidden="true"
          className={`col-start-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 font-display text-32 font-bold tabular-nums ${shared}`}
        >
          {reps !== null && (
            <span>
              <KeepRanges text={reps} />
            </span>
          )}
          {e.prescribed !== null && (
            <span>
              <KeepRanges text={e.prescribed} />
            </span>
          )}
        </p>
      )}
      <p aria-hidden="true" className={`col-start-2 flex min-w-0 flex-wrap gap-x-4 text-20 ${shared}`}>
        {suggestion.kg !== null ? (
          <span>
            <span className={`font-normal ${label}`}>Forslag</span>{" "}
            <span className="font-bold whitespace-nowrap">{suggestion.kg}</span>
          </span>
        ) : (
          <span className={label}>{suggestion.words}</span>
        )}
        {lastWeek !== undefined &&
          (lastWeek === null ? (
            <span className={label}>Intet logget sidste uge</span>
          ) : (
            <span>
              <span className={label}>Sidste uge</span> <span className="font-medium">{lastWeek}</span>
            </span>
          ))}
      </p>
      <ol aria-label="Sæt" className="col-span-2 -mx-1 mt-1 flex flex-col">
        {group.sets.map((line) => (
          <li key={`${line.ref.row}#${line.ref.set}`}>
            <SetLine group={group} line={line} week={week} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function SetLine({ group, line, week }: { readonly group: SetGroupView; readonly line: SetLineView; readonly week: number }) {
  const { setLog } = useSession();
  const { slab } = group;
  const status = setStatus(line);
  const muted = line.state !== "open" ? (slab ? "text-on-slab-muted" : "text-text-muted") : "";
  // open -> done; done -> open (undo); skipped -> done.
  const toggle = () => setLog.tap(line.state === "done" ? "undo" : "done", line.ref);
  return (
    <label
      className={`grid min-h-11 cursor-pointer grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-control px-1 py-2 has-focus-visible:outline-3 has-focus-visible:outline-offset-3 ${
        slab ? "has-focus-visible:outline-slab-mark" : "has-focus-visible:outline-focus"
      } ${muted}`}
    >
      <input type="checkbox" className="sr-only" checked={line.state === "done"} onChange={toggle} />
      <span className="sr-only">{spokenSetLine(group.exercise, week, line)}</span>
      <span aria-hidden="true" className="flex items-center">
        <Check state={line.state} slab={slab} />
      </span>
      <span aria-hidden="true" className="min-w-0 text-20 font-semibold tabular-nums">
        Sæt {line.n} af {line.of}
      </span>
      <span aria-hidden="true" className="justify-self-end text-right">
        {line.next ? (
          <span className="rounded-mark bg-slab-mark px-2 py-0.5 text-14 font-bold tracking-[0.08em] text-slab uppercase">
            Næste
          </span>
        ) : status !== null ? (
          <span className={`text-14 tabular-nums ${slab ? "text-on-slab-muted" : "text-text-muted"}`}>{status}</span>
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
          <button
            type="button"
            onClick={setLog.retry}
            className="inline-flex min-h-11 items-center px-1 text-16 font-semibold text-text underline underline-offset-3"
          >
            Gem igen
          </button>
        </WarningLine>
      )}
      {setLog.rejected && <WarningLine>Et tryk blev afvist. Genindlæs siden.</WarningLine>}
      {(devSwitches || setLog.dev) && <p className="text-14 text-text-muted">Testvisning: sæt gemmes ikke.</p>}
    </>
  );
}

const RANGE = /(\d+(?:[.,]\d+)?\s+-\s+\d+(?:[.,]\d+)?)/;

/**
 * The text exactly as written, with each "8 - 12" kept on one line: at large text sizes a
 * break inside a range would leave "8 -" / "12", which reads like "-12".
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

const CHECK_MOTION =
  "transition-[background-color,border-color,transform] duration-120 ease-out motion-safe:active:scale-90 motion-reduce:transition-none";

/**
 * 28px circle (shape carries the meaning, not colour): open = a --text-muted ring; done = --slab
 * fill with a --slab-mark ✓; skipped = the ring with a minus bar. Inside the slab the roles swap
 * to --slab-mark (3px ring).
 */
function Check({ state, slab }: { readonly state: SetState; readonly slab: boolean }) {
  if (state === "done") {
    return (
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-full ${CHECK_MOTION} ${
          slab ? "bg-slab-mark text-slab" : "bg-slab text-slab-mark"
        }`}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m3.5 8.5 3 3 6-7" />
        </svg>
      </span>
    );
  }
  const ring = slab ? "border-3 border-slab-mark" : "border-[2.5px] border-text-muted";
  return (
    <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${ring} ${CHECK_MOTION}`}>
      {state === "skipped" && (
        <span className={`h-[2.5px] w-3 rounded-full ${slab ? "bg-slab-mark" : "bg-text-muted"}`} />
      )}
    </span>
  );
}
