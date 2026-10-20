/**
 * Optagelser's hidden overview (slice clip-summary): one plain line per clip with its server
 * status and this phone's last background outcome (auto-last.ts), then a count line, so every
 * clip's reason can be read and copied at once. Local only (aggregates, never a landmark). Pure.
 */
import { type AutoLast, runText } from "./auto-last.ts";

/** What a line needs of a clip: the shown name, the set (Fokus's "Sæt n"), its length and the server's status. */
export type SummaryClip = {
  readonly name: string;
  readonly set: number;
  readonly durationS: number | null;
  /** The server's auto_status; null = not analysed yet ("venter"). */
  readonly serverStatus: string | null;
};

const comma1 = (v: number): string => v.toFixed(1).replace(".", ",");
const dash = (v: number | null): string => (v === null || !Number.isFinite(v) ? "–" : String(v));

/** The local outcome's words: kind · reason or step · fundet n/m · joint · gyldige NN % · mode · run. */
function localPart(last: AutoLast): string {
  const parts: string[] = [last.kind];
  if (last.step !== undefined) parts.push(last.step);
  if (last.reason !== undefined) parts.push(last.reason);
  const s = last.summary;
  if (s !== undefined) {
    const found = s.chosen === 1 ? s.peaksUp : s.chosen === -1 ? s.peaksDown : null;
    parts.push(`fundet ${dash(found)}/${dash(s.expected)}`, s.joint ?? "–", `gyldige ${s.validShare === null ? "–" : `${Math.round(s.validShare * 100)} %`}`);
  }
  if (last.mode !== null) parts.push(last.mode);
  if (last.runMs !== null) parts.push(runText(last.runMs));
  return parts.join(" · ");
}

/** One clip's line, e.g. "Squat sæt 2 · 51,8 s · low_confidence · low_confidence · count · fundet 4/5 · hips · gyldige 93 % · play · 22 s". */
export function summaryLine(clip: SummaryClip, last: AutoLast | null): string {
  const length = clip.durationS === null || !Number.isFinite(clip.durationS) ? "–" : `${comma1(clip.durationS)} s`;
  const head = `${clip.name} sæt ${clip.set} · ${length} · ${clip.serverStatus ?? "venter"}`;
  return last === null ? `${head} · ingen lokal kørsel` : `${head} · ${localPart(last)}`;
}

const byCount = (a: readonly [string, number], b: readonly [string, number]): number => b[1] - a[1] || a[0].localeCompare(b[0]);

/**
 * The count line: low_confidence by reason first, then every other local outcome and the clips
 * without one, e.g. "low_confidence: count 6 · few_frames 2; clipped 3; ingen lokal kørsel 2".
 */
export function countLine(lasts: readonly (AutoLast | null)[]): string {
  const reasons = new Map<string, number>();
  const kinds = new Map<string, number>();
  for (const l of lasts) {
    if (l === null) kinds.set("ingen lokal kørsel", (kinds.get("ingen lokal kørsel") ?? 0) + 1);
    else if (l.kind === "low_confidence") reasons.set(l.reason ?? "ukendt", (reasons.get(l.reason ?? "ukendt") ?? 0) + 1);
    else kinds.set(l.kind, (kinds.get(l.kind) ?? 0) + 1);
  }
  const low = reasons.size === 0 ? "low_confidence: 0" : `low_confidence: ${[...reasons].toSorted(byCount).map(([r, n]) => `${r} ${n}`).join(" · ")}`;
  return [low, ...[...kinds].toSorted(byCount).map(([k, n]) => `${k} ${n}`)].join("; ");
}

/** The whole overview as Kopiér alle copies it: the lines, newest first, then the count line. */
export function summaryText(items: readonly { readonly clip: SummaryClip; readonly last: AutoLast | null }[]): string {
  return [...items.map((i) => summaryLine(i.clip, i.last)), countLine(items.map((i) => i.last))].join("\n");
}

/** The overview's history entry (closed by the back gesture, like the player's). */
export const SUMMARY_HISTORY_STATE = "clipSummary";

export function isSummaryEntry(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as Record<string, unknown>)[SUMMARY_HISTORY_STATE] === true; // history.state is untyped
}
