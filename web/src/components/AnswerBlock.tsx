import type { AnswerBlock as AnswerBlockView, AnswersView } from "@/lib/analyse-answers";
import { describeDataError } from "@/lib/data-error";
import type { SummaryDirection } from "@/lib/db/rows";

import { ErrorState } from "./ErrorState";

/** The three answer blocks on top of Cykel (analyse.md §12), or §12d's error in their place. */
export function AnswerBlocks({ view }: { readonly view: AnswersView }) {
  if (view.kind === "error") {
    return (
      <div className="mt-3 lg:mt-0">
        <ErrorState
          title="Kunne ikke hente svarene"
          what={
            view.error === null
              ? "Læsning af analysis_summary fra databasen mislykkedes."
              : describeDataError(view.error)
          }
          detail={view.error?.message}
          retry={{ href: "/analyse" }}
        />
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-10 lg:mt-0">
      {view.blocks.map((b) => (
        <AnswerBlock key={b.question} block={b} />
      ))}
    </div>
  );
}

/**
 * §12a: question row with the "?", figure row, verdict, detail; §12b: the explanation inline below.
 * Instrument (instrument-analyse.md §2): question = caption, number Inter 400 tabular (56 / 44), the
 * caption line an Inter 14 muted sentence, verdict Inter 16; no box.
 */
export function AnswerBlock({ block }: { readonly block: AnswerBlockView }) {
  const id = `svar-${block.question}`;
  return (
    <section aria-labelledby={id} className="relative">
      <h3 id={id} className="caption flex min-h-6 items-center pr-12">
        {block.title}
      </h3>
      {block.kind === "missing" ? (
        <p className="mt-1 max-w-[60ch] text-16 text-text-muted">{block.text}</p>
      ) : (
        <>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            {block.figure.arrow !== null && <Arrow direction={block.figure.arrow} />}
            <span className="sr-only">{block.figure.sr}</span>
            <span
              aria-hidden="true"
              className={`font-sans leading-none font-normal tabular-nums ${
                block.figure.large ? "text-56" : "text-48"
              }`}
            >
              {block.figure.number}
            </span>
            <span className="basis-full text-14 text-text-muted tabular-nums">{block.figure.caption}</span>
          </p>
          <p className="mt-2 max-w-[60ch] text-16 text-text">{block.verdict}</p>
          {block.detail !== null && (
            <p className="mt-1 max-w-[60ch] text-14 text-text-muted tabular-nums">{block.detail}</p>
          )}
        </>
      )}
      <details className="group">
        {/* 44×44 target at the end of the question row (absolute to the section), the circle inside. */}
        <summary className="absolute -top-2.5 -right-2.5 flex size-11 cursor-pointer list-none items-center justify-center focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
          <span className="sr-only">{`Forklaring: ${block.title}`}</span>
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center border border-text-muted font-sans text-14 leading-none font-medium text-text group-open:border-text group-open:bg-text group-open:text-bg"
          >
            ?
          </span>
        </summary>
        <div className="mt-2 flex max-w-[60ch] flex-col gap-2 text-14 text-text-muted">
          {block.disclosure.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      </details>
    </section>
  );
}

/** 24px neutral arrow (never coloured: the sentence carries the meaning). ↗ up, ↘ down, → flat. */
function Arrow({ direction }: { readonly direction: SummaryDirection }) {
  const d =
    direction === "up"
      ? "M6 18 18 6M9 6h9v9"
      : direction === "down"
        ? "M6 6l12 12M18 9v9H9"
        : "M4 12h16M14 6l6 6-6 6";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-6 shrink-0 self-center text-text"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d={d} />
    </svg>
  );
}
