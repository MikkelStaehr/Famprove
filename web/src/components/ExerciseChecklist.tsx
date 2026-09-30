"use client";

import type { IsoDate } from "@/lib/db/rows";
import { formatSetLoad, formatSetsReps, spokenExercise } from "@/lib/format";
import type { ExerciseView } from "@/lib/today-view";

import { tickKey, useTicks } from "./TickProvider";

/**
 * Today's sheet rows as tick rows (DESIGN.md › Today › Tick rows, Part B › NÆSTE slab). Each row
 * is a <label> wrapping a native, controlled checkbox, so the whole row is the target and Space
 * toggles it. Visible text is exactly as written in the sheet; the accessible name is one
 * sr-only sentence ("Squat, 1 sæt af 3 reps ved RPE 5, sidste uge 100 kg") and the visual copy
 * is aria-hidden.
 */

type ProgressProps = {
  readonly date: IsoDate;
  /** ExerciseView.key of every row in the session. */
  readonly rowKeys: readonly string[];
};

function useDoneCount(date: IsoDate, rowKeys: readonly string[]): number {
  const { ticked } = useTicks();
  return rowKeys.filter((key) => ticked.has(tickKey(date, key))).length;
}

/** Card action: "0 af 11 udført" / "Alle 11 udført". Not a live region: each checkbox announces itself. */
export function TickProgress({ date, rowKeys }: ProgressProps) {
  const total = rowKeys.length;
  const done = useDoneCount(date, rowKeys);
  return (
    <p className="text-16 font-semibold tabular-nums">
      {done === total ? (
        `Alle ${total} udført`
      ) : (
        <>
          <span className="font-display text-24 font-extrabold italic">{done}</span> af {total} udført
        </>
      )}
    </p>
  );
}

/** One 8px segment per row; the first k (ticked count, not positions) are --slab. aria-hidden. */
export function TickSegments({ date, rowKeys }: ProgressProps) {
  const done = useDoneCount(date, rowKeys);
  return (
    <div aria-hidden="true" className="flex gap-1">
      {rowKeys.map((key, i) => (
        <span
          key={key}
          className={`h-2 flex-1 rounded-mark transition-colors duration-120 ease-out motion-reduce:transition-none ${
            i < done ? "bg-slab" : "bg-track"
          }`}
        />
      ))}
    </div>
  );
}

type ListProps = {
  readonly date: IsoDate;
  readonly week: number;
  readonly exercises: readonly ExerciseView[];
};

/** One <li> per sheet row in sheet order; consecutive rows with the same name form one run. */
export function ExerciseList({ date, week, exercises }: ListProps) {
  const { ticked, setTicked } = useTicks();
  // The NÆSTE slab: the first unticked row in document order; none when every row is ticked.
  const nextIndex = exercises.findIndex((e) => !ticked.has(tickKey(date, e.key)));
  return (
    <ol aria-label="Øvelser" className="flex flex-col">
      {exercises.map((exercise, i) => {
        const name = exercise.name.trim();
        const runStart = i === 0 || exercises[i - 1].name.trim() !== name;
        const key = tickKey(date, exercise.key);
        // The run's name only reads as done once every row of the run is ticked, so "Squat"
        // never looks finished after the first top set. Only the run's first row shows it.
        let runDone = false;
        if (runStart) {
          let end = i + 1;
          while (end < exercises.length && exercises[end].name.trim() === name) end += 1;
          runDone = exercises.slice(i, end).every((row) => ticked.has(tickKey(date, row.key)));
        }
        // Dividers go between runs only; the slab hides the dividers it touches.
        const divider = runStart && i > 0 && i !== nextIndex && i - 1 !== nextIndex;
        return (
          <li key={exercise.key} className={divider ? "border-t border-border" : undefined}>
            <ExerciseRow
              exercise={exercise}
              week={week}
              showName={runStart}
              runDone={runDone}
              next={i === nextIndex}
              done={ticked.has(key)}
              onToggle={(done) => setTicked(key, done)}
            />
          </li>
        );
      })}
    </ol>
  );
}

type RowProps = {
  readonly exercise: ExerciseView;
  readonly week: number;
  /** First row of a run: the name shows. Continuation rows carry it in the sr-only sentence. */
  readonly showName: boolean;
  /** Every row of this row's run is ticked (only read when showName). */
  readonly runDone: boolean;
  /** The NÆSTE row: slab fill, and the name always shows. */
  readonly next: boolean;
  readonly done: boolean;
  readonly onToggle: (done: boolean) => void;
};

function ExerciseRow({ exercise: e, week, showName, runDone, next, done, onToggle }: RowProps) {
  const amount = formatSetsReps(e.setsText, e.repsText);
  // undefined: week 1 has no reference line; null: nothing logged last week (never "0 kg").
  const lastWeek =
    week < 2 ? undefined : e.reference === null ? null : formatSetLoad(e.reference.kg, e.reference.bodyweight);
  const nameShown = showName || next;
  // Grid rows: [name], prescription (with the check beside it), [last week].
  const line = nameShown ? "row-start-2" : "row-start-1";
  const refLine = nameShown ? "row-start-3" : "row-start-2";
  const tone = next ? "bg-slab text-on-slab" : done ? "text-text-muted" : "";
  return (
    <label
      className={`relative grid min-h-11 cursor-pointer grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 rounded-control transition-colors duration-180 ease-out motion-reduce:transition-none has-focus-visible:outline-3 has-focus-visible:outline-offset-3 has-focus-visible:outline-focus ${
        next ? "-mx-2 my-2 p-3" : "px-1 py-2"
      } ${tone}`}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={done}
        onChange={(event) => onToggle(event.currentTarget.checked)}
      />
      <span className="sr-only">
        {spokenExercise(e, lastWeek)}
        {next && ", næste"}
      </span>
      {nameShown && (
        <span
          aria-hidden="true"
          className={`col-start-2 row-start-1 flex items-baseline justify-between gap-x-3 text-20 font-bold ${next || runDone ? "" : "text-text"}`}
        >
          <span className="min-w-0">{e.name}</span>
          {next && (
            <span className="shrink-0 rounded-mark bg-slab-mark px-2 py-0.5 text-14 font-bold tracking-[0.08em] text-slab uppercase">
              Næste
            </span>
          )}
        </span>
      )}
      <span aria-hidden="true" className={`col-start-1 ${line} flex h-lh items-end pb-1 text-32`}>
        <Check done={done} next={next} />
      </span>
      <span
        aria-hidden="true"
        className={`col-start-2 ${line} flex min-w-0 flex-wrap gap-x-4 gap-y-1 font-display text-32 font-bold tabular-nums`}
      >
        {amount !== null && (
          <span>
            <KeepRanges text={amount} />
          </span>
        )}
        {e.prescribed !== null && (
          <span>
            <KeepRanges text={e.prescribed} />
          </span>
        )}
      </span>
      {lastWeek !== undefined && (
        <span aria-hidden="true" className={`col-start-2 ${refLine} text-20`}>
          {lastWeek === null ? (
            <span className={next ? "text-on-slab-muted" : "text-text-muted"}>Intet logget sidste uge</span>
          ) : (
            <>
              <span className={next ? "text-on-slab-muted" : "text-text-muted"}>Sidste uge</span>{" "}
              <span className="font-medium">{lastWeek}</span>
            </>
          )}
        </span>
      )}
    </label>
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
 * 28px circle: a 2.5px --text-muted ring (3px --slab-mark on the NÆSTE row), or filled --slab
 * with a --slab-mark ✓ (the shape carries the meaning, not only colour).
 */
function Check({ done, next }: { readonly done: boolean; readonly next: boolean }) {
  if (!done) {
    return (
      <span
        className={`size-7 shrink-0 rounded-full ${CHECK_MOTION} ${
          next ? "border-3 border-slab-mark" : "border-[2.5px] border-text-muted"
        }`}
      />
    );
  }
  return (
    <span className={`flex size-7 shrink-0 items-center justify-center rounded-full bg-slab text-slab-mark ${CHECK_MOTION}`}>
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
