import { SECONDARY } from "./instrument";
import { DiamondIcon } from "./WarningLine";

type EmptyStateProps = {
  /** One sentence. */
  readonly message: string;
  readonly action?: { readonly href: string; readonly label: string };
};

/** DESIGN.md EmptyState (Revision 5): an ink ◆, one sentence, optional action as the secondary. */
export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-start gap-3 py-2">
      <p className="flex items-start gap-2 text-16 text-text">
        <span className="flex h-lh shrink-0 items-center">
          <DiamondIcon />
        </span>
        {message}
      </p>
      {action !== undefined && (
        <a href={action.href} className={SECONDARY}>
          {action.label}
        </a>
      )}
    </div>
  );
}
