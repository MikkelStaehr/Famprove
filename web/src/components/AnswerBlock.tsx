import type { AnswerBlock as AnswerBlockView, AnswersView } from "@/lib/analyse-answers";
import { describeDataError } from "@/lib/data-error";
import type { SummaryDirection } from "@/lib/db/rows";

import { ErrorState } from "./ErrorState";
import { Icon } from "./icons";

/** Card look shared by the answers (reset-analyse-cykel.md §3): --card, 1px --border, radius 22, padding 20. */
export const ANSWER_CARD = "relative flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-5 lg:self-stretch";

/**
 * The three answer cards on top of Cykel (analyse.md §12; look reset-analyse-cykel.md §3), or
 * §12d's error in one card in their place. `lg:contents` lets each card be its own grid cell.
 */
export function AnswerBlocks({ view }: { readonly view: AnswersView }) {
  if (view.kind === "error") {
    return (
      <div className={`${ANSWER_CARD} lg:col-span-3`}>
        <ErrorState
          title="Kunne ikke hente svarene"
          what={view.error === null ? "Læsning af analysis_summary fra databasen mislykkedes." : describeDataError(view.error)}
          detail={view.error?.message}
          retry={{ href: "/analyse" }}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 lg:contents">
      {view.blocks.map((b) => (
        <AnswerBlock key={b.question} block={b} />
      ))}
    </div>
  );
}

/**
 * One answer card (C's hero header, A's tile language): MonoCaption question + a 44px "?" button,
 * the number in Geist Mono with a neutral arrow, Python's caption, verdict and detail verbatim; the
 * explanation opens under a hairline.
 */
export function AnswerBlock({ block }: { readonly block: AnswerBlockView }) {
  const id = `svar-${block.question}`;
  return (
    <section aria-labelledby={id} className={ANSWER_CARD}>
      <h3 id={id} className="flex min-h-11 items-center pr-14 font-mono text-11 font-normal text-text-muted uppercase">
        {block.title}
      </h3>
      {block.kind === "missing" ? (
        <p className="max-w-[60ch] font-sans text-15 text-text-muted">{block.text}</p>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2.5">
            {block.figure.arrow !== null && <Arrow direction={block.figure.arrow} />}
            <span className="sr-only">{block.figure.sr}</span>
            {/* Spec §3: Geist Mono 40, 48 when figure.large (the eFTP answer). */}
            <span aria-hidden="true" className={`font-mono ${block.figure.large ? "text-48" : "text-40"} font-medium text-text tabular-nums`}>
              {block.figure.number}
            </span>
          </p>
          <p className="font-sans text-13 text-text-muted tabular-nums">{block.figure.caption}</p>
          <p className="max-w-[60ch] font-sans text-15 text-text">{block.verdict}</p>
          {block.detail !== null && <p className="max-w-[60ch] font-sans text-13 text-text-muted tabular-nums">{block.detail}</p>}
        </>
      )}
      <details className="group">
        {/* The 44×44 "?" sits at the end of the question row (absolute to the card). */}
        <summary className="absolute top-5 right-5 flex size-11 cursor-pointer list-none items-center justify-center rounded-button border border-raised bg-card font-sans text-15 font-medium text-text group-open:border-inverse-bg group-open:bg-inverse-bg group-open:text-inverse-text [&::-webkit-details-marker]:hidden">
          <span className="sr-only">{`Forklaring: ${block.title}`}</span>
          <span aria-hidden="true">?</span>
        </summary>
        <div className="mt-3 flex max-w-[60ch] flex-col gap-2 border-t border-border pt-3 font-sans text-13 text-text-muted">
          {block.disclosure.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </details>
    </section>
  );
}

/** 20px neutral arrow (↗ ↘ →), 1.5px stroke, --text (never coloured: the sentence carries the meaning). */
function Arrow({ direction }: { readonly direction: SummaryDirection }) {
  const name = direction === "up" ? "arrow-up-right" : direction === "down" ? "arrow-down-right" : "arrow-flat";
  return <Icon name={name} size={20} className="self-center text-text" />;
}
