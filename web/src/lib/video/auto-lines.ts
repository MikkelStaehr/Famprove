/**
 * clip-auto's words (design/specs/clip-auto.md): Fokus's slot line per phase (§1), the library row's
 * meta word and the player's line (§2), and the pickup's selection (§1 "Pickup"). Pure.
 */
import type { AutoStatus, LiftFamily } from "./auto-clip.ts";
import type { AutoProgress } from "./auto-run.ts";
import type { VideoClipRow } from "./clips.ts";
import { formatRange } from "./cut-lines.ts";
import type { ClipIndexEntry } from "./index-store.ts";

/** Fokus's slot: a phase on, or the outcome. */
export type FokusAutoPhase = AutoProgress | { readonly kind: "clipped"; readonly inS: number; readonly outS: number } | { readonly kind: "low_confidence" } | { readonly kind: "failed" };

/**
 * One line: the words (Geist), then a figure in Geist Mono; `figureHidden` = the % (aria-hidden,
 * never announced). `spoken` is what the status region says.
 */
export type AutoLine = { readonly words: string; readonly figure: string | null; readonly figureHidden: boolean; readonly spoken: string };

export const LOW_LINE = "Kunne ikke finde løftet sikkert. Klip selv i Optagelser under Træning.";
export const FAILED_LINE = "Automatisk klip mislykkedes. Hele videoen er gemt.";
export const PLAYER_LOW_LINE = "Løftet blev ikke fundet sikkert, så videoen er ikke klippet.";
export const PLAYER_FAILED_LINE = "Automatisk klip mislykkedes. Gem og Del giver hele videoen.";

const pct = (p: number | null): string | null => (p === null ? null : `${p} %`);

/** §1's lines 2–6. */
export function fokusAutoLine(phase: FokusAutoPhase): AutoLine {
  switch (phase.kind) {
    case "model":
      return { words: "Henter klippemodel …", figure: pct(phase.pct), figureHidden: true, spoken: "Henter klippemodel …" };
    case "running":
      return { words: "Klipper video …", figure: pct(phase.pct), figureHidden: true, spoken: "Klipper video …" };
    case "clipped": {
      const range = formatRange(phase.inS, phase.outS);
      return { words: "Klippet automatisk", figure: range, figureHidden: false, spoken: `Klippet automatisk ${range}` };
    }
    case "low_confidence":
      return { words: LOW_LINE, figure: null, figureHidden: false, spoken: LOW_LINE };
    case "failed":
      return { words: FAILED_LINE, figure: null, figureHidden: false, spoken: FAILED_LINE };
  }
}

/** True for the outcome phases (the second and last announcement). */
export function isOutcome(phase: FokusAutoPhase): boolean {
  return phase.kind === "clipped" || phase.kind === "low_confidence" || phase.kind === "failed";
}

type CutCols = Pick<VideoClipRow, "clipInS" | "clipOutS" | "autoStatus">;

/** The user's own range is set (it wins over every auto value). */
export function hasOwnRange(row: Pick<VideoClipRow, "clipInS" | "clipOutS">): boolean {
  return row.clipInS !== null && row.clipOutS !== null;
}

/** §2's row meta word after the duration; null = none (not run, WebM, no server row). */
export function autoMetaWord(ext: "mp4" | "webm" | null, server: CutCols | null, running: boolean): string | null {
  if (ext === "webm") return null;
  if (running) return "klipper …";
  if (server === null) return null;
  if (hasOwnRange(server)) return "klippet";
  if (server.autoStatus === "clipped") return "auto-klippet";
  if (server.autoStatus === "low_confidence" || server.autoStatus === "failed") return "klip selv";
  return null;
}

/** §2's player line for a clip without the user's range and without a clipped cut; null = clip-cut's line (or none). */
export function playerAutoLine(status: AutoStatus | null, running: { readonly pct: number } | null): { readonly words: string; readonly figure: string | null } | null {
  if (running !== null) return { words: "Klipper video …", figure: `${running.pct} %` };
  if (status === "low_confidence") return { words: PLAYER_LOW_LINE, figure: null };
  if (status === "failed") return { words: PLAYER_FAILED_LINE, figure: null };
  return null;
}

/** §2: `Klip` reads `Klip selv` on low_confidence and failed; an own range reads `Ret klip`. */
export function editLabel(server: CutCols): "Ret klip" | "Klip selv" | "Klip" {
  if (hasOwnRange(server)) return "Ret klip";
  return server.autoStatus === "low_confidence" || server.autoStatus === "failed" ? "Klip selv" : "Klip";
}

/** What the pickup needs of a clip's set (read server-side, readClipLifts). */
export type ClipLiftMeta = { readonly family: LiftFamily; readonly expected: number | null };

/** The pickup's window: clips recorded in the last 7 days. */
export const PICKUP_DAYS = 7;

/**
 * §1 Pickup: the clips to analyse, newest first: auto_status null, MP4, a done local file with a
 * server row, recorded within PICKUP_DAYS of `now`, and no own range.
 */
export function pickupQueue(local: readonly ClipIndexEntry[], rows: readonly VideoClipRow[], now: Date): VideoClipRow[] {
  const files = new Map(local.filter((e) => e.state === "done" && e.ext === "mp4").map((e) => [e.id, e]));
  const since = now.getTime() - PICKUP_DAYS * 86_400_000;
  return rows
    .filter((r) => r.autoStatus === null && !hasOwnRange(r) && files.has(r.id) && Date.parse(r.recordedAt) >= since && Date.parse(r.recordedAt) <= now.getTime() + 60_000)
    .toSorted((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
}
