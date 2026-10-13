"use client";

import type { SetState } from "@/lib/set-taps";
import {
  adjustmentBrackets,
  lastWeekText,
  repsText,
  type SetGroupView,
  type SetLineView,
  setStatus,
  spokenSetLine,
  suggestionView,
} from "@/lib/training-view";

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

/** The strength head: "**0** af 24 sæt udført" / "Alle sæt klaret", plus "2 sprunget over". Not live. */
export function SetCount() {
  const { done, skipped, total } = useSession().view.progress;
  return (
    <div className="flex flex-col">
      <p className="font-sans text-16 font-normal tabular-nums">
        {done + skipped === total ? (
          "Alle sæt klaret"
        ) : (
          <>
            <span className="text-24 font-medium">{done}</span> af {total} sæt udført
          </>
        )}
      </p>
      {skipped > 0 && <p className="text-14 text-text-muted tabular-nums">{skipped} sprunget over</p>}
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
          className={i === 0 ? undefined : group.dividerBefore ? "mt-4 border-t border-border pt-4" : "mt-3"}
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
  const brackets = adjustmentBrackets(e, "long");
  const lastWeek = lastWeekText(e, week);
  const shared = closed ? "text-text-muted" : "";
  return (
    // The NÆSTE group: no fill, a 2px ink bar on its left edge at x −12px, full group height (§1).
    <div className={`relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 px-1`}>
      {slab && <span aria-hidden="true" data-next-edge="true" className="absolute inset-y-0 -left-3 w-0.5 bg-text" />}
      <p
        className={`col-start-2 min-w-0 font-sans text-20 font-medium break-words ${group.showName ? "" : "sr-only"} ${
          group.showName && group.nameMuted ? "text-text-muted" : ""
        }`}
      >
        {e.name}
      </p>
      {(reps !== null || e.prescribed !== null) && (
        <p
          aria-hidden="true"
          className={`col-start-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 font-sans text-32 font-medium tabular-nums ${shared}`}
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
      <div aria-hidden="true" className={`col-start-2 mt-1 flex min-w-0 flex-wrap gap-x-6 gap-y-2 ${shared}`}>
        {suggestion.kg !== null ? (
          <p className="flex flex-col">
            <span className="caption">Forslag</span>
            <span className="font-sans text-20 font-normal tabular-nums">
              <span className="whitespace-nowrap">{suggestion.kg}</span>
              {brackets !== null && <span className="text-16 text-text-muted"> {brackets}</span>}
            </span>
          </p>
        ) : (
          <p className="text-16 text-text-muted">{suggestion.words}</p>
        )}
        {lastWeek !== undefined &&
          (lastWeek === null ? (
            <p className="text-16 text-text-muted">Intet logget sidste uge</p>
          ) : (
            <p className="flex flex-col">
              <span className="caption">Sidste uge</span>
              <span className="font-sans text-20 font-normal whitespace-nowrap tabular-nums">{lastWeek}</span>
            </p>
          ))}
      </div>
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
  const status = setStatus(line);
  const muted = line.state !== "open" ? "text-text-muted" : "";
  // open -> done; done -> open (undo); skipped -> done.
  const toggle = () => setLog.tap(line.state === "done" ? "undo" : "done", line.ref);
  return (
    <label
      className={`grid min-h-11 cursor-pointer grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 px-1 py-2 has-focus-visible:outline-3 has-focus-visible:outline-offset-3 has-focus-visible:outline-focus ${muted}`}
    >
      <input type="checkbox" className="sr-only" checked={line.state === "done"} onChange={toggle} />
      <span className="sr-only">{spokenSetLine(group.exercise, week, line)}</span>
      <span aria-hidden="true" className="flex items-center justify-center">
        <SetTick state={line.state} />
      </span>
      <span aria-hidden="true" className="min-w-0 font-sans text-20 font-normal tabular-nums">
        Sæt {line.n} af {line.of}
      </span>
      <span aria-hidden="true" className="justify-self-end text-right">
        {line.next ? (
          <span className="caption text-text">Næste</span>
        ) : status !== null ? (
          <span className="text-14 text-text-muted tabular-nums">{status}</span>
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

/**
 * The set tick (§2.1), a 12 × 28 rect in the 28px column; read down the list the ticks are a
 * vertical barcode of the session. Open = 1px --text-muted outline ([A5], ≥ 3:1); done = --text
 * fill; skipped = the outline + a 12 × 2 --text-muted bar across the middle. No motion.
 */
function SetTick({ state }: { readonly state: SetState }) {
  if (state === "done") return <span data-tick="done" className="block h-7 w-3 shrink-0 bg-text" />;
  return (
    <span data-tick={state} className="flex h-7 w-3 shrink-0 items-center border border-text-muted">
      {state === "skipped" && <span className="-mx-px block h-0.5 w-3 shrink-0 bg-text-muted" />}
    </span>
  );
}
