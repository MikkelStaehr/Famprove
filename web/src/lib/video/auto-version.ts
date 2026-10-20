/**
 * Which analysis version each clip was analysed with on this phone (slice clip-auto-2): the pickup
 * re-runs a clip whose version is below ALGO_VERSION. localStorage `famprove.clips.autoVersion` →
 * `{ [clip id]: version }`, written only after a run whose setClipAuto succeeded; a clip without a
 * record counts as version 1 (analysed before versions were kept). Storage is injected, so node tests it.
 */
import { ALGO_VERSION } from "./auto-clip.ts";
import type { AutoOutcome } from "./auto-run.ts";

export const AUTO_VERSION_KEY = "famprove.clips.autoVersion";
/** The version a clip without a record was analysed with. */
export const UNRECORDED_VERSION = 1;

export type AutoVersions = Readonly<Record<string, number>>;
type KeyStore = Pick<Storage, "getItem" | "setItem">;

/** The stored map; anything unreadable is an empty map (every clip then counts as version 1). */
export function parseAutoVersions(raw: string | null): AutoVersions {
  if (raw === null) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number" && Number.isInteger(e[1]))); // narrowed per entry
  } catch {
    return {};
  }
}

export function versionOf(versions: AutoVersions, id: string): number {
  return Object.hasOwn(versions, id) ? versions[id]! : UNRECORDED_VERSION;
}

export function readAutoVersions(store: KeyStore | null): AutoVersions {
  try {
    return parseAutoVersions(store?.getItem(AUTO_VERSION_KEY) ?? null);
  } catch {
    return {};
  }
}

/** Records that clip `id` was analysed with ALGO_VERSION; a full or blocked storage is ignored (the clip is then re-run once more). */
export function recordAutoVersion(store: KeyStore | null, id: string): void {
  try {
    if (store === null) return;
    store.setItem(AUTO_VERSION_KEY, JSON.stringify({ ...readAutoVersions(store), [id]: ALGO_VERSION }));
  } catch {
    // ignored: see above
  }
}

/** Records the version after a run whose setClipAuto succeeded (clipped, low_confidence or failed, saved); aborted and skipped wrote nothing. */
export function recordIfSaved(store: KeyStore | null, id: string, out: AutoOutcome): void {
  if ((out.kind === "clipped" || out.kind === "low_confidence" || out.kind === "failed") && out.saved) recordAutoVersion(store, id);
}

/** window.localStorage, or null where it can't be reached. */
export function browserStore(): KeyStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
