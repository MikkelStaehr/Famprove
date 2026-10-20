/**
 * Gem and Gem alle fra i dag (slice clip-save, design/specs/clip-save.md): a clip goes to Chrome's
 * Downloads through a detached <a download> on a blob URL. Nothing goes to the server: this module
 * imports no server action and makes no request. Pure: the download, the read, the clock and the
 * timers are injected, so the sequence is tested with fakes.
 */
import type { IsoDate } from "../db/rows.ts";
import type { LibraryRow } from "./library-view.ts";

/** The pause between two downloads of Gem alle (§5). */
export const DOWNLOAD_GAP_MS = 400;
/** A blob URL is revoked this long after its click, never on the click (§6: Android reads it after). */
export const REVOKE_AFTER_MS = 60_000;
/** The shown name's length in a file name (§3). */
export const NAME_PART_MAX = 60;
/** Names listed in a missing / unreadable line before "og n til" (§10). */
const LISTED_MAX = 3;

export type NameRow = Pick<LibraryRow, "id" | "kind" | "ext" | "exercise" | "variant" | "date" | "set" | "recordedAt">;

/** `/ \ : * ? " < > |` and control characters become "-"; spaces collapsed and trimmed; æøå kept. */
export function safeNamePart(text: string): string {
  const cleaned = text.replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, NAME_PART_MAX).trim();
}

/** The row's shown name as a file name part (variant's display name, else the exercise). */
function namePart(row: NameRow): string {
  return safeNamePart(row.variant ?? row.exercise) || "Optagelse";
}

function hasFile(row: NameRow): boolean {
  return (row.kind === "clip" || row.kind === "afbrudt") && row.ext !== null;
}

/** Oldest first by recordedAt; ties by id. */
export function byRecorded<T extends Pick<NameRow, "recordedAt" | "id">>(a: T, b: T): number {
  return a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * id → file name for every row with a local file (§3, §4): `<date> <name> sæt <n>[ afbrudt][ klip k].<ext>`.
 * Run it over all local rows, so a clip gets the same name from Gem and from Gem alle.
 */
export function clipFileNames(rows: readonly NameRow[]): Map<string, string> {
  const groups = new Map<string, NameRow[]>();
  for (const r of rows.filter(hasFile)) {
    const key = [r.date, namePart(r), r.set, r.ext].join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out = new Map<string, string>();
  for (const group of groups.values()) {
    const sorted = [...group].sort(byRecorded);
    sorted.forEach((r, i) => {
      const afbrudt = r.kind === "afbrudt" ? " afbrudt" : "";
      const klip = sorted.length > 1 ? ` klip ${i + 1}` : "";
      out.set(r.id, `${r.date} ${namePart(r)} sæt ${r.set}${afbrudt}${klip}.${r.ext}`);
    });
  }
  return out;
}

/** The short label in a missing / unreadable list: "Squat sæt 2". */
export function clipLabel(row: NameRow): string {
  return `${namePart(row)} sæt ${row.set}`;
}

/** Gem alle's clips (§2): today's rows with a local file, oldest first. */
export function todaysClips<T extends NameRow>(rows: readonly T[], today: IsoDate): T[] {
  return rows.filter((r) => r.date === today && hasFile(r)).sort(byRecorded);
}

export type Timers = {
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

/** Blob URLs waiting to be revoked: each REVOKE_AFTER_MS after its click, or all at once (unmount, pagehide). Each once. */
export type UrlKeeper = { readonly add: (url: string) => void; readonly revokeAll: () => void; readonly pending: () => number };

export function urlKeeper(revoke: (url: string) => void, timers: Timers): UrlKeeper {
  const open = new Map<string, unknown>();
  return {
    add(url) {
      if (open.has(url)) return;
      open.set(
        url,
        timers.setTimeout(() => {
          if (!open.delete(url)) return;
          revoke(url);
        }, REVOKE_AFTER_MS),
      );
    },
    revokeAll() {
      for (const [url, handle] of [...open]) {
        timers.clearTimeout(handle);
        open.delete(url);
        revoke(url);
      }
    },
    pending: () => open.size,
  };
}

export type SaveClip = { readonly id: string; readonly name: string; readonly label: string };

export type SaveDeps = {
  /** The clip's file; null = no such file (§10); a throw = the storage didn't answer (§11). */
  readonly read: (id: string) => Promise<Blob | null>;
  /** Download one file: create its URL, click it and hand the URL to the keeper. */
  readonly download: (blob: Blob, name: string) => void;
  readonly sleep: (ms: number) => Promise<void>;
  /** "Gemmer k af n": k = the clip being saved, 1-based. */
  readonly onProgress: (k: number, total: number) => void;
  /** True once the page is hidden or the card is gone: stop after the current clip (§9). */
  readonly aborted: () => boolean;
};

export type SaveResult = {
  readonly sent: number;
  readonly missing: readonly SaveClip[];
  readonly unreadable: readonly SaveClip[];
  /** Not attempted because the run stopped; Gem resten saves these. */
  readonly remaining: readonly SaveClip[];
  readonly total: number;
};

/** Gem alle's sequence (§5): read → download → wait DOWNLOAD_GAP_MS → next, oldest first. */
export async function saveSequence(clips: readonly SaveClip[], deps: SaveDeps): Promise<SaveResult> {
  let sent = 0;
  const missing: SaveClip[] = [];
  const unreadable: SaveClip[] = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i] as SaveClip;
    if (i > 0 && deps.aborted()) return { sent, missing, unreadable, remaining: clips.slice(i), total: clips.length };
    deps.onProgress(i + 1, clips.length);
    let blob: Blob | null;
    try {
      blob = await deps.read(clip.id);
    } catch {
      unreadable.push(clip);
      continue;
    }
    if (blob === null) {
      missing.push(clip);
      continue;
    }
    deps.download(blob, clip.name);
    sent += 1;
    if (i < clips.length - 1) await deps.sleep(DOWNLOAD_GAP_MS);
  }
  return { sent, missing, unreadable, remaining: [], total: clips.length };
}

function listed(clips: readonly SaveClip[]): string {
  const names = clips.slice(0, LISTED_MAX).map((c) => c.label).join(", ");
  const more = clips.length - LISTED_MAX;
  return more > 0 ? `${names} og ${more} til` : names;
}

/** §7: shown while a run of 2+ clips goes. */
export const PROMPT_LINE = "Chrome spørger måske, om siden må hente flere filer. Vælg Tillad.";

export function progressLine(k: number, total: number): string {
  return `Gemmer ${k} af ${total} …`;
}

/** §8–§11: the line after a run. */
export function doneLine(r: SaveResult): string {
  if (r.remaining.length > 0) return `Stoppet ved ${r.total - r.remaining.length} af ${r.total}.`;
  const parts = [`${r.sent} klip sendt til Downloads.`];
  if (r.total >= 2) {
    parts.push(
      "Mangler nogle, har Chrome blokeret flere filer: Chrome › Indstillinger › Websiteindstillinger › Automatiske downloads › Tillad. Ellers tryk Gem på det enkelte klip.",
    );
  }
  if (r.missing.length > 0) parts.push(`${r.missing.length} ${r.missing.length === 1 ? "fil mangler" : "filer mangler"} på telefonen: ${listed(r.missing)}.`);
  if (r.unreadable.length > 0) parts.push(`${r.unreadable.length} ${r.unreadable.length === 1 ? "fil" : "filer"} kunne ikke læses: ${listed(r.unreadable)}.`);
  return parts.join(" ");
}

/** A detached <a download> click on a blob URL (§5); the keeper revokes the URL later (§6). */
export function browserDownload(keeper: UrlKeeper): (blob: Blob, name: string) => void {
  return (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.click();
    keeper.add(url);
  };
}
