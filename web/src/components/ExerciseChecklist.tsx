"use client";

import type { IsoDate } from "@/lib/db/rows";
import { formatSetLoad, formatSetsReps, spokenExercise } from "@/lib/format";
import type { ExerciseView } from "@/lib/today-view";

import { tickKey, useTicks } from "./TickProvider";

/**
 * Today's sheet rows as tick rows (DESIGN.md › Today › Tick rows). Each row is a <label>
 * wrapping a native, controlled checkbox, so the whole row is the target and Space toggles it.
 * Visible text is exactly as written in the sheet; the accessible name is one sr-only sentence
 * ("Squat, 1 set of 3 reps at RPE 5, last week 100 kg") and the visual copy is aria-hidden.
 */

type ProgressProps = {
  readonly date: IsoDate;
  /** ExerciseView.key of every row in the session. */
  readonly rowKeys: readonly string[];
};

/** Card action: "0 of 11 done" / "All 11 done". Not a live region: each checkbox announces itself. */
export function TickProgress({ date, rowKeys }: ProgressProps) {
  const { ticked } = useTicks();
  const total = rowKeys.length;
  const done = rowKeys.filter((key) => ticked.has(tickKey(date, key))).length;
  return (
    <p className="text-16 font-semibold tabular-nums">
      {done === total ? `All ${total} done` : `${done} of ${total} done`}
    </p>
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
  return (
    <ol aria-label="Exercises" className="flex flex-col">
      {exercises.map((exercise, i) => {
        const runStart = i === 0 || exercises[i - 1].name.trim() !== exercise.name.trim();
        const key = tickKey(date, exercise.key);
        return (
          // Dividers go between runs only, never inside one.
          <li key={exercise.key} className={runStart && i > 0 ? "border-t border-border" : undefined}>
            <ExerciseRow
              exercise={exercise}
              week={week}
              showName={runStart}
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
  readonly done: boolean;
  readonly onToggle: (done: boolean) => void;
};

function ExerciseRow({ exercise: e, week, showName, done, onToggle }: RowProps) {
  const amount = formatSetsReps(e.setsText, e.repsText);
  // undefined: week 1 has no reference line; null: nothing logged last week (never "0 kg").
  const lastWeek =
    week < 2 ? undefined : e.reference === null ? null : formatSetLoad(e.reference.kg, e.reference.bodyweight);
  // Grid rows: [name], prescription (with the check beside it), [last week].
  const line = showName ? "row-start-2" : "row-start-1";
  const refLine = showName ? "row-start-3" : "row-start-2";
  return (
    <label
      className={`relative grid min-h-11 cursor-pointer grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 rounded-control py-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${
        done ? "text-text-muted" : ""
      }`}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={done}
        onChange={(event) => onToggle(event.currentTarget.checked)}
      />
      <span className="sr-only">{spokenExercise(e, lastWeek)}</span>
      {showName && (
        <span aria-hidden="true" className="col-start-2 row-start-1 text-20 font-semibold">
          {e.name}
        </span>
      )}
      <span aria-hidden="true" className={`col-start-1 ${line} flex h-lh items-center text-28`}>
        <Check done={done} />
      </span>
      <span
        aria-hidden="true"
        className={`col-start-2 ${line} flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-28 font-bold`}
      >
        {amount !== null && (
          <span className="tabular-nums">
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
            <span className="text-text-muted">Nothing logged last week</span>
          ) : (
            <>
              <span className="text-text-muted">Last week</span>{" "}
              <span className="font-semibold">{lastWeek}</span>
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

/** 28px circle: a --text-muted ring, or filled --positive with a ✓ (the shape carries the meaning). */
function Check({ done }: { readonly done: boolean }) {
  if (!done) return <span className="size-7 shrink-0 rounded-full border-2 border-text-muted" />;
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-positive text-surface">
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
