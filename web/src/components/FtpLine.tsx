"use client";

import { useEffect, useId, useRef, useState } from "react";

import { chooseFtpAnswer, undoFtpAnswer } from "@/app/actions";
import type { FtpAckChoice } from "@/lib/db/rows";
import {
  choiceLabel,
  choiceResult,
  type FtpChoiceResult,
  type FtpLine as FtpLineState,
  SAVE_FAILED,
  UNDO_FAILED,
  UNDO_LABEL,
  WARNING_SR_SUFFIX,
} from "@/lib/ftp-line";

import { Icon } from "./icons";
import { MonoCaption } from "./MonoCaption";
import { WarningLine } from "./WarningLine";

/**
 * /load's FTP line (design/specs/ftp-confirm.md §1–§3). `quiet` is a muted mono line, nothing to
 * tap. `warning` is a disclosure: the WarningLine is one button, its panel holds two secondary
 * choices; a choice hides the warning at once (optimistic) and shows its result with Fortryd in the
 * always-present status region. All texts come from lib/ftp-line.ts.
 */
export function FtpLine({ line }: { readonly line: FtpLineState }) {
  if (line.kind === "quiet") {
    return (
      <MonoCaption as="p" uppercase={false}>
        {line.text}
      </MonoCaption>
    );
  }
  if (line.kind === "warning") return <FtpWarning text={line.text} ftpW={line.ftpW} />;
  return null;
}

type Phase =
  | { readonly kind: "warning"; readonly open: boolean; readonly saveFailed: boolean }
  | { readonly kind: "result"; readonly choice: FtpAckChoice; readonly undoFailed: boolean; readonly undoing: boolean };

type FocusTarget = "line" | "undo" | FtpAckChoice | null;

const CHOICES: readonly FtpAckChoice[] = ["confirmed", "fixed"];

const CHOICE_BUTTON =
  "inline-flex h-11 items-center rounded-button border border-text-muted px-3.5 font-sans text-15 font-medium text-text active:opacity-85";

function FtpWarning({ text, ftpW }: { readonly text: string; readonly ftpW: number }) {
  const panelId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: "warning", open: false, saveFailed: false });
  const focusRef = useRef<FocusTarget>(null);
  const lineRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const choiceRefs = useRef<Partial<Record<FtpAckChoice, HTMLButtonElement | null>>>({});
  // The save in flight: Fortryd before it answers waits for its id (null = nothing was written).
  const saveRef = useRef<Promise<FtpChoiceResult> | null>(null);

  useEffect(() => {
    const target = focusRef.current;
    if (target === null) return;
    focusRef.current = null;
    const el = target === "line" ? lineRef.current : target === "undo" ? undoRef.current : (choiceRefs.current[target] ?? null);
    el?.focus();
  }, [phase]);

  const backToPanel = (choice: FtpAckChoice, saveFailed: boolean) => {
    focusRef.current = choice;
    setPhase({ kind: "warning", open: true, saveFailed });
  };

  const toggle = () => {
    if (phase.kind !== "warning") return;
    setPhase({ kind: "warning", open: !phase.open, saveFailed: false });
  };

  const close = () => {
    if (phase.kind !== "warning" || !phase.open) return;
    focusRef.current = "line";
    setPhase({ kind: "warning", open: false, saveFailed: false });
  };

  const choose = (choice: FtpAckChoice) => {
    focusRef.current = "undo";
    setPhase({ kind: "result", choice, undoFailed: false, undoing: false });
    const save = chooseFtpAnswer(choice).catch((): FtpChoiceResult => ({ ok: false, reason: "failed" }));
    saveRef.current = save;
    void save.then((result) => {
      if (saveRef.current !== save) return;
      if (!result.ok) {
        saveRef.current = null;
        backToPanel(choice, true);
      }
    });
  };

  const undo = async () => {
    if (phase.kind !== "result" || phase.undoing) return;
    const { choice } = phase;
    const save = saveRef.current;
    setPhase({ kind: "result", choice, undoFailed: false, undoing: true });
    const saved = save === null ? null : await save;
    if (saved === null || !saved.ok) return; // the failed save already put the warning back
    if (saved.id === null) {
      // Dev switch: nothing was written, so Fortryd only restores the screen.
      saveRef.current = null;
      backToPanel(choice, false);
      return;
    }
    let undone = false;
    try {
      undone = (await undoFtpAnswer(saved.id)).ok;
    } catch {
      undone = false;
    }
    if (undone) {
      saveRef.current = null;
      backToPanel(choice, false);
    } else {
      focusRef.current = "undo";
      setPhase({ kind: "result", choice, undoFailed: true, undoing: false });
    }
  };

  const cut = text.lastIndexOf(" ") + 1;
  return (
    // 6px more than the header's 8px gap: the line's 44px box starts ≥ 14px under the status region (refresh R2).
    <div
      className="mt-1.5 flex flex-col"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      {phase.kind === "warning" && (
        <>
          <button
            ref={lineRef}
            type="button"
            aria-expanded={phase.open}
            aria-controls={panelId}
            onClick={toggle}
            className="group flex min-h-11 max-w-[65ch] items-center self-start rounded-control py-[13px] text-left font-sans text-13 text-text active:opacity-85"
          >
            <span className="flex items-start gap-2">
              <span className="flex h-lh shrink-0 items-center text-warning">
                <Icon name="warning" size={16} />
              </span>
              <span>
                <span className="group-hover:underline">{text.slice(0, cut)}</span>
                <span className="whitespace-nowrap">
                  <span className="group-hover:underline">{text.slice(cut)}</span>
                  <Icon
                    name="chevron-down"
                    size={16}
                    className={`ml-1 inline-block align-[-3px] text-text transition-transform duration-150 motion-reduce:transition-none ${
                      phase.open ? "rotate-180" : ""
                    }`}
                  />
                </span>
                <span className="sr-only">{WARNING_SR_SUFFIX}</span>
              </span>
            </span>
          </button>
          <div id={panelId} hidden={!phase.open} className="pl-6">
            <div className="flex flex-wrap gap-2">
              {CHOICES.map((choice) => (
                <button
                  key={choice}
                  ref={(el) => {
                    choiceRefs.current[choice] = el;
                  }}
                  type="button"
                  onClick={() => choose(choice)}
                  className={CHOICE_BUTTON}
                >
                  {choiceLabel(choice, ftpW)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <div role="status" aria-live="polite">
        {phase.kind === "warning" && phase.saveFailed && (
          <div className="mt-2.5">
            <WarningLine>{SAVE_FAILED}</WarningLine>
          </div>
        )}
        {phase.kind === "result" && (
          <>
            {/* Same 44px box as the line it replaces; Fortryd's hit area stays inside it. */}
            <p className="flex items-start gap-2 py-[13px] font-sans text-13 text-text-muted">
              <span className="flex h-lh shrink-0 items-center text-text">
                <Icon name="check" size={16} />
              </span>
              <span>
                {choiceResult(phase.choice)}{" "}
                <button
                  ref={undoRef}
                  type="button"
                  aria-disabled={phase.undoing ? true : undefined}
                  onClick={() => void undo()}
                  className="relative rounded-control text-text underline before:absolute before:-inset-x-1 before:-inset-y-[13px] before:content-[''] active:opacity-85"
                >
                  {UNDO_LABEL}
                </button>
              </span>
            </p>
            {phase.undoFailed && <WarningLine>{UNDO_FAILED}</WarningLine>}
          </>
        )}
      </div>
    </div>
  );
}
