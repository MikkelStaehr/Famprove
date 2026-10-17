/**
 * Sharing a clip through the phone's share sheet (slice video-library): navigator.share({ files }).
 * The file name says what and when, never the time of day: "squat-2026-10-17-saet-1.mp4". Pure
 * apart from the injected navigator; canShare is checked first.
 */
import type { IsoDate } from "../db/rows.ts";
import { type ClipExt, fileTypeOf } from "./mime.ts";

const LETTERS: Readonly<Record<string, string>> = { æ: "ae", ø: "oe", å: "aa" };

/** Lower case, æ/ø/å spelt out, accents dropped, anything else a single "-". */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[æøå]/g, (c) => LETTERS[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function shareFileName(clip: { readonly exerciseName: string; readonly date: IsoDate; readonly set: number; readonly ext: ClipExt }): string {
  const name = slug(clip.exerciseName) || "saet";
  return `${name}-${clip.date}-saet-${clip.set}.${clip.ext}`;
}

export type ShareNavigator = {
  readonly canShare?: (data: ShareData) => boolean;
  readonly share?: (data: ShareData) => Promise<void>;
};

export type ShareOutcome = "shared" | "unsupported" | "cancelled" | "failed";

export function shareData(blob: Blob, fileName: string, ext: ClipExt): ShareData {
  return { files: [new File([blob], fileName, { type: fileTypeOf(ext) })] };
}

/** "unsupported" when the phone can't share this file; "cancelled" when the user closed the sheet. */
export async function shareClip(nav: ShareNavigator, data: ShareData): Promise<ShareOutcome> {
  if (typeof nav.canShare !== "function" || typeof nav.share !== "function" || !nav.canShare(data)) return "unsupported";
  try {
    await nav.share(data);
    return "shared";
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "failed";
  }
}
