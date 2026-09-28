import type { Tone } from "@/lib/dashboard-view";

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  neutral: "text-text-muted",
  positive: "text-positive",
  warning: "text-warning",
  negative: "text-negative",
};

/** Semantic colour always paired with the text label (DESIGN.md: never colour alone). */
export function StatusBadge({ tone, label }: { readonly tone: Tone; readonly label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-control border border-current px-2 py-1 text-14 font-semibold ${TONE_CLASS[tone]}`}
    >
      <ToneIcon tone={tone} />
      {label}
    </span>
  );
}

/** Shape differs per tone as well as colour; decorative (the label carries the meaning). */
function ToneIcon({ tone }: { readonly tone: Tone }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 shrink-0" fill="currentColor">
      {tone === "positive" && <circle cx="6" cy="6" r="5" />}
      {tone === "neutral" && <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="2" />}
      {tone === "warning" && <path d="M6 1 11 11H1Z" />}
      {tone === "negative" && <rect x="1.5" y="1.5" width="9" height="9" transform="rotate(45 6 6)" />}
    </svg>
  );
}
