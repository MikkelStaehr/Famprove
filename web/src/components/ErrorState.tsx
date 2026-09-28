import Link from "next/link";

type Retry =
  // Server-rendered: a soft navigation re-reads the route. Never a full reload, so Today's
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

const RETRY_CLASS =
  "inline-flex min-h-11 items-center rounded-control border border-border bg-surface px-4 text-14 font-semibold text-accent";

/** DESIGN.md ErrorState: what failed, when, retry. */
export function ErrorState({ title, what, detail, at, retry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2">
      <p className="flex items-center gap-2 text-16 font-semibold text-negative">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0" fill="currentColor">
          <rect x="3" y="3" width="10" height="10" transform="rotate(45 8 8)" />
        </svg>
        {title}
      </p>
      <p className="text-14">{what}</p>
      {detail !== undefined && <p className="text-12 text-text-muted">{detail}</p>}
      {at !== undefined && (
        <p className="text-12 text-text-muted">
          Tried at <time dateTime={at.iso}>{at.text}</time>
        </p>
      )}
      {"href" in retry ? (
        <Link href={retry.href} prefetch={false} className={RETRY_CLASS}>
          Try again
        </Link>
      ) : (
        <button type="button" onClick={retry.onRetry} className={RETRY_CLASS}>
          Try again
        </button>
      )}
    </div>
  );
}
