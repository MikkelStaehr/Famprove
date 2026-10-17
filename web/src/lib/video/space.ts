/**
 * The space line on Træning (slice video-library): navigator.storage.estimate() as Danish numbers.
 * Decimal units as the phone's own storage screen (1 MB = 1 000 000 bytes): under 1 GB whole MB,
 * from 1 GB one decimal with a comma ("1,2 GB"). Pure; the caller passes the estimate.
 */

const MB = 1_000_000;
const GB = 1_000_000_000;

/** "0 MB", "< 1 MB", "312 MB", "1,2 GB", "12,0 GB". Null for a missing or unreadable value (never 0). */
export function formatBytes(bytes: number | undefined): string | null {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes === 0) return "0 MB";
  if (bytes < GB) {
    const mb = Math.round(bytes / MB);
    if (mb === 0) return "< 1 MB";
    if (mb < 1000) return `${mb} MB`;
  }
  return `${(Math.round(bytes / GB * 10) / 10).toFixed(1).replace(".", ",")} GB`;
}

export type SpaceLine = {
  readonly used: string | null; // what this origin uses (the clips, mostly)
  readonly free: string | null; // quota − usage: what the browser still allows this origin
};

export function spaceLine(estimate: { readonly usage?: number; readonly quota?: number } | null): SpaceLine {
  if (estimate === null) return { used: null, free: null };
  const { usage, quota } = estimate;
  const free = usage !== undefined && quota !== undefined && quota >= usage ? quota - usage : undefined;
  return { used: formatBytes(usage), free: formatBytes(free) };
}
