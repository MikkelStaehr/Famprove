/**
 * app_notices on /load (one line per kind, written by the daily job). Why and what next, per kind (DESIGN.md week card, review 2026-10-13): a second
 * sentence in the same WarningLine. The FTP one is true in both directions, so it never guesses
 * whether TSS is too high or too low.
 */
const NOTICE_NEXT_STEP: Readonly<Partial<Record<string, string>>> = {
  ftp_mismatch: "Cykel-TSS regnes ud fra FTP, så ret den i intervals.icu.",
};

/** Python's notice as written (it may lack a final stop), plus its next-step sentence if the kind has one. */
export function noticeText(kind: string, message: string): string {
  const next = NOTICE_NEXT_STEP[kind];
  if (next === undefined) return message;
  return `${message}${message.endsWith(".") ? "" : "."} ${next}`;
}
