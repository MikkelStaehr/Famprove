"use client";

import { useId, useState } from "react";

import { Icon } from "@/components/icons";
import {
  canDecrease,
  kgError,
  type PartDraft,
  type PartsDraft,
  partsCaption,
  partsFailedText,
  partsRefusedText,
  partRowLabels,
  repsError,
  stepKg,
  stepReps,
} from "@/lib/parts-editor";

import { FokusWarning, OUTLINED } from "./Instrument";
import type { PartsProblem } from "./usePartsSave";

const STEP_BUTTON =
  "flex size-11 shrink-0 items-center justify-center rounded-button border border-text-muted bg-card text-text active:opacity-85 disabled:border-dashed disabled:text-text-muted";

/**
 * combo-parts.md §1–§6: the parts of the set just done, under the feel row, in place of the reps
 * stepper. One row per part: name, the Pr. side toggle, and a kg and a reps stepper with a typeable
 * figure. Edits are kept by the screen (usePartsSave) and saved on the next done, Afslut or hide.
 */
export function PartsEditor({
  draft,
  exercise,
  problem,
  onEdit,
  onRetry,
}: {
  readonly draft: PartsDraft;
  /** In a superset (S15) the caption names the exercise; null otherwise. */
  readonly exercise: string | null;
  readonly problem: PartsProblem | null;
  readonly onEdit: (draft: PartsDraft) => void;
  readonly onRetry: () => void;
}) {
  const { caption, group } = partsCaption(draft.set, exercise);
  const change = (partNo: number, patch: Partial<PartDraft>) =>
    onEdit({ ...draft, dirty: true, parts: draft.parts.map((p) => (p.partNo === partNo ? { ...p, ...patch } : p)) });
  const mine = problem !== null && problem.set === draft.set ? problem : null;
  return (
    <section role="group" aria-label={group} className="mt-6 flex flex-col">
      <p aria-hidden="true" className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-mono text-12 text-text-muted uppercase">{caption}</span>
        <span className="font-mono text-12 text-text-muted uppercase">Valgfrit</span>
      </p>
      <ul className="mt-1 flex flex-col">
        {draft.parts.map((p) => (
          <PartRow key={p.partNo} part={p} onChange={(patch) => change(p.partNo, patch)} />
        ))}
      </ul>
      {mine !== null && (
        <div role="alert" className="mt-3">
          {mine.kind === "failed" ? (
            <FokusWarning>
              {partsFailedText(mine.set)} De står her, men forsvinder, hvis siden genindlæses.{" "}
              <button type="button" onClick={onRetry} className={`min-h-11 px-4 ${OUTLINED}`}>
                Gem igen
              </button>
            </FokusWarning>
          ) : (
            <FokusWarning>{partsRefusedText(mine.set)}</FokusWarning>
          )}
        </div>
      )}
    </section>
  );
}

function PartRow({ part, onChange }: { readonly part: PartDraft; readonly onChange: (patch: Partial<PartDraft>) => void }) {
  const labels = partRowLabels(part.name);
  return (
    <li className="flex flex-col gap-3 border-t border-border pt-3.5 pb-3.5 first:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <span className="font-sans text-16 font-medium [overflow-wrap:anywhere]">{part.name}</span>
        {/* 32px visible, 44px hit (the padding around the box). */}
        <button
          type="button"
          aria-pressed={part.perSide}
          aria-label={labels.toggle}
          onClick={() => onChange({ perSide: !part.perSide })}
          className="group -my-1.5 flex min-h-11 shrink-0 items-center"
        >
          <span
            className={`flex h-8 items-center gap-1.5 rounded-button border border-text-muted px-3 font-mono text-13 font-medium text-text uppercase tracking-[0.04em] group-active:opacity-85 ${
              part.perSide ? "bg-raised" : "bg-card"
            }`}
          >
            {part.perSide && <Icon name="check" size={16} />}
            Pr. side
          </span>
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stepper
          caption="Kg"
          text={part.kgText}
          inputMode="decimal"
          validate={kgError}
          less={labels.kgLess}
          more={labels.kgMore}
          inputLabel={labels.kgInput}
          canLess={canDecrease(part.kgText, "kg")}
          onStep={(d) => onChange({ kgText: stepKg(part.kgText, d) })}
          onType={(kgText) => onChange({ kgText })}
        />
        <Stepper
          caption="Reps"
          text={part.repsText}
          inputMode="numeric"
          validate={repsError}
          less={labels.repsLess}
          more={labels.repsMore}
          inputLabel={labels.repsInput}
          canLess={canDecrease(part.repsText, "reps")}
          onStep={(d) => onChange({ repsText: stepReps(part.repsText, d) })}
          onType={(repsText) => onChange({ repsText })}
        />
      </div>
    </li>
  );
}

function Stepper({
  caption,
  text,
  inputMode,
  validate,
  less,
  more,
  inputLabel,
  canLess,
  onStep,
  onType,
}: {
  readonly caption: string;
  readonly text: string;
  readonly inputMode: "decimal" | "numeric";
  readonly validate: (text: string) => string | null;
  readonly less: string;
  readonly more: string;
  readonly inputLabel: string;
  readonly canLess: boolean;
  readonly onStep: (direction: 1 | -1) => void;
  readonly onType: (text: string) => void;
}) {
  const id = useId();
  // §5: checked on blur (and after a step); the typed text stays.
  const [error, setError] = useState<string | null>(() => validate(text));
  const step = (d: 1 | -1) => {
    onStep(d);
    setError(null);
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={`${id}-v`} className="font-mono text-11 text-text-muted uppercase">
        {caption}
      </label>
      <div className="flex items-center gap-1">
        <button type="button" disabled={!canLess} aria-disabled={!canLess} onClick={() => step(-1)} className={STEP_BUTTON}>
          <Icon name="minus" size={20} />
          <span className="sr-only">{less}</span>
        </button>
        <input
          id={`${id}-v`}
          aria-label={inputLabel}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? `${id}-e` : undefined}
          inputMode={inputMode}
          autoComplete="off"
          placeholder="–"
          value={text}
          onChange={(e) => onType(e.target.value)}
          onBlur={() => setError(validate(text))}
          className="h-11 w-full min-w-0 rounded-button bg-transparent text-center font-mono text-24 font-medium tabular-nums text-text placeholder:text-text-muted"
        />
        <button type="button" onClick={() => step(1)} className={STEP_BUTTON}>
          <Icon name="plus" size={20} />
          <span className="sr-only">{more}</span>
        </button>
      </div>
      {error !== null && (
        <p id={`${id}-e`} className="text-14 text-text">
          {error}
        </p>
      )}
    </div>
  );
}
