type EmptyStateProps = {
  /** One sentence. */
  readonly message: string;
  readonly action?: { readonly href: string; readonly label: string };
};

/** DESIGN.md EmptyState: icon, one sentence, optional action. */
export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-3 py-2">
      <p className="flex items-start gap-2 text-16 text-text-muted">
        <span className="flex h-lh shrink-0 items-center">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <path d="M5 10h6" strokeLinecap="round" />
          </svg>
        </span>
        {message}
      </p>
      {action !== undefined && (
        <a
          href={action.href}
          className="inline-flex min-h-11 items-center rounded-pill bg-track px-4 text-16 font-semibold text-text focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-focus"
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
