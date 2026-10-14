"use client";

import type { SetState } from "@/lib/set-taps";
import {
  adjustmentBrackets,
  lastWeekText,
  prescribedText,
  repsText,
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

/** The sheet rows in sheet order; runs of the same name share one visible name. */
export function SetChecklist() {
  const { session, view } = useSession();
  return (
    <ol aria-label="Øvelser" className="flex flex-col">
      {view.groups.map((group, i) => (
        <li
          key={group.exercise.key}
          className={i === 0 ? undefined : group.dividerBefore ? "mt-4 border-t border-border pt-4" : "mt-4"}
        >
          <SetGroup group={group} week={session.week} />
        </li>
      ))}
    </ol>
  );
}

function SetGroup({ group, week }: { readonly group: SetGroupView; readonly week: number }) {
  const { exercise: e, isNext, closed } = group;
  const reps = repsText(e);
  const prescribed = prescribedText(e);
  const suggestion = suggestionView(e);
  const brackets = adjustmentBrackets(e, "long");
  const lastWeek = lastWeekText(e, week);
  const shared = closed ? "text-text-muted" : "";
  return (
    // The NÆSTE group: no fill, a 2px --text bar on its left edge at x −12px, full group height (§2.5).
    <div className="relative flex flex-col">
      {isNext && <span aria-hidden="true" data-next-edge="true" className="absolute inset-y-0 -left-3 w-0.5 bg-text" />}
      <p
        className={`min-w-0 font-sans text-16 font-medium break-words ${group.showName ? "" : "sr-only"} ${
          group.showName && group.nameMuted ? "text-text-muted" : "text-text"
        }`}
      >
        {e.name}
      </p>
      {(reps !== null || prescribed !== null) && (
        <p
          aria-hidden="true"
          className={`mt-1 flex min-w-0 flex-wrap gap-x-4 gap-y-1 font-mono text-20 font-medium tabular-nums ${shared}`}
        >
          {reps !== null && (
            <span>
              <KeepRanges text={reps} />
            </span>
          )}
          {prescribed !== null && (
            <span>
              <KeepRanges text={prescribed} />
            </span>
          )}
        </p>
      )}
      <div aria-hidden="true" className={`mt-2.5 grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 ${shared}`}>
        {suggestion.kg !== null ? (
          <p className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-12 text-text-muted uppercase">Forslag</span>
            <span className="font-mono text-16 tabular-nums">
              <span className="whitespace-nowrap">{suggestion.kg}</span>
              {brackets !== null && <span className="font-sans text-13 text-text-muted"> {brackets}</span>}
            </span>
          </p>
        ) : (
          <p className="min-w-0 text-14 text-text-muted">{suggestion.words}</p>
        )}
        {lastWeek !== undefined &&
          (lastWeek === null ? (
            <p className="col-start-2 min-w-0 text-14 text-text-muted">Intet logget sidste uge</p>
          ) : (
            <p className="col-start-2 flex min-w-0 flex-col gap-1">
              <span className="font-mono text-12 text-text-muted uppercase">Sidste uge</span>
              <span className="font-mono text-16 tabular-nums">{lastWeek}</span>
            </p>
          ))}
      </div>
      <ol aria-label="Sæt" className="mt-2.5 flex flex-col">
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
