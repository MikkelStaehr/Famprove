/**
 * clip-auto's words (design/specs/clip-auto.md): Fokus's slot line per phase (§1), the library row's
 * meta word and the player's line (§2), and the pickup's selection (§1 "Pickup"). Pure.
 */
import { ALGO_VERSION, type AutoStatus, type LiftFamily } from "./auto-clip.ts";
import type { AutoProgress } from "./auto-run.ts";
import type { VideoClipRow } from "./clips.ts";
import { formatRange } from "./cut-lines.ts";
import type { ClipIndexEntry } from "./index-store.ts";
import { type AutoVersions, versionOf } from "./auto-version.ts";

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
/** An MP4 clip not analysed yet (auto_status null, slice clip-auto-2): it waits for the pickup, never "Klip selv". */
export const PLAYER_WAITING_LINE = "Venter på klip";

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

/**
 * §2's row meta word after the duration; null = none (WebM, no server row). Not run yet:
 * `venter på klip`, but only while the pickup will take it (`waiting`: within PICKUP_DAYS), so an
 * older clip never waits for good (review 2026-10-20).
 */
export function autoMetaWord(ext: "mp4" | "webm" | null, server: CutCols | null, running: boolean, waiting = true): string | null {
  if (ext === "webm") return null;
  if (running) return "klipper …";
  if (server === null) return null;
  if (hasOwnRange(server)) return "klippet";
  if (server.autoStatus === "clipped") return "auto-klippet";
  if (server.autoStatus === "low_confidence" || server.autoStatus === "failed") return "klip selv";
  return ext === "mp4" && waiting ? "venter på klip" : null;
}

/**
 * §2's player line for an MP4 clip (the caller never asks for WebM) without the user's range and
 * without a clipped cut; null = clip-cut's line (or none). auto_status null: `Venter på klip`.
 */
export function playerAutoLine(status: AutoStatus | null, running: { readonly pct: number } | null, waiting = true): { readonly words: string; readonly figure: string | null } | null {
  if (running !== null) return { words: "Klipper video …", figure: `${running.pct} %` };
  if (status === "low_confidence") return { words: PLAYER_LOW_LINE, figure: null };
  if (status === "failed") return { words: PLAYER_FAILED_LINE, figure: null };
  if (status === null) return waiting ? { words: PLAYER_WAITING_LINE, figure: null } : null;
  return null;
}

/** §2: `Klip` reads `Klip selv` on low_confidence and failed (never while waiting: null reads `Klip`); an own range reads `Ret klip`. */
export function editLabel(server: CutCols): "Ret klip" | "Klip selv" | "Klip" {
  if (hasOwnRange(server)) return "Ret klip";
  return server.autoStatus === "low_confidence" || server.autoStatus === "failed" ? "Klip selv" : "Klip";
}

/** What the pickup needs of a clip's set (read server-side, readClipLifts). */
export type ClipLiftMeta = { readonly family: LiftFamily; readonly expected: number | null };

/** The pickup's window: clips recorded in the last 7 days. */
export const PICKUP_DAYS = 7;

/**
 * §1 Pickup: the clips to analyse, newest first: MP4, a done local file with a server row, recorded
 * within PICKUP_DAYS of `now`, and either auto_status null or analysed on this phone with a version
 * below ALGO_VERSION (`versions`; none recorded = 1). An own range doesn't exclude it (slice
 * clip-auto-2): it still wins in cutRange, and the auto values are kept for the accuracy comparison.
 */
/** Recorded within the pickup's window of `now` (and not in the future beyond a minute's skew). */
export function inPickupWindow(recordedAt: string, now: Date): boolean {
  const at = Date.parse(recordedAt);
  return at >= now.getTime() - PICKUP_DAYS * 86_400_000 && at <= now.getTime() + 60_000;
}

export function pickupQueue(local: readonly ClipIndexEntry[], rows: readonly VideoClipRow[], now: Date, versions: AutoVersions = {}): VideoClipRow[] {
  const files = new Map(local.filter((e) => e.state === "done" && e.ext === "mp4").map((e) => [e.id, e]));
  const due = (r: VideoClipRow): boolean => r.autoStatus === null || versionOf(versions, r.id) < ALGO_VERSION;
  return rows
    .filter((r) => due(r) && files.has(r.id) && inPickupWindow(r.recordedAt, now))
    .toSorted((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
}
