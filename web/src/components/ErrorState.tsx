import Link from "next/link";

import { SECONDARY } from "./instrument";
import { Icon } from "./icons";

type Retry =
  // Server-rendered: a soft navigation re-reads the route. Never a full reload, so Træning's
  // ticks (held in the root layout) survive a retry.
  | { readonly href: string }
  | { readonly onRetry: () => void }; // client boundary: re-render

type ErrorStateProps = {
  readonly title: string;
  /** What failed, in one sentence. */
  readonly what: string;
  /** Technical detail safe to show (names tables/variables, never values or secrets). */
  readonly detail?: string;
  /** When it failed: ISO timestamp + display text. */
  readonly at?: { readonly iso: string; readonly text: string };
  readonly retry: Retry;
};

const RETRY_CLASS = SECONDARY;

/** DESIGN.md ErrorState (Ember): the warning icon + a Geist 16/500 title in --text (never red), what failed, when, retry. */
export function ErrorState({ title, what, detail, at, retry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="flex items-center gap-2 font-sans text-16 font-medium text-text">
        <Icon name="warning" size={16} className="text-warning" />
        {title}
      </p>
      <p className="font-sans text-15 text-text">{what}</p>
      {detail !== undefined && <p className="font-mono text-12 text-text-muted">{detail}</p>}
      {at !== undefined && (
        <p className="font-sans text-13 text-text-muted">
          Forsøgt <time dateTime={at.iso}>{at.text}</time>
        </p>
      )}
      {"href" in retry ? (
        <Link href={retry.href} prefetch={false} className={RETRY_CLASS}>
          Prøv igen
        </Link>
      ) : (
        <button type="button" onClick={retry.onRetry} className={RETRY_CLASS}>
          Prøv igen
        </button>
      )}
    </div>
  );
}
