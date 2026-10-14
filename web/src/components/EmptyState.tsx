import { SECONDARY } from "./instrument";

type EmptyStateProps = {
  /** One sentence. */
  readonly message: string;
  readonly action?: { readonly href: string; readonly label: string };
};

/** DESIGN.md EmptyState (Ember): one Geist text-15 --text-muted sentence, optional action as the secondary. */
export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-3 py-1">
      <p className="max-w-[60ch] font-sans text-15 text-text-muted">{message}</p>
      {action !== undefined && (
        <a href={action.href} className={SECONDARY}>
          {action.label}
        </a>
      )}
    </div>
  );
}
