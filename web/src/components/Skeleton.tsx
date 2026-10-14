/** One skeleton bar, one text line tall at the given text size (so the shape matches the content). */
export function SkeletonBar({ className }: { readonly className: string }) {
  return <span className={`block h-lh rounded-cell bg-raised motion-safe:animate-pulse ${className}`} />;
}
