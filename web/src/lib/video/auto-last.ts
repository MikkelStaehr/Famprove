/**
 * The last background outcome per clip, on this phone only (slice clip-auto-3): localStorage
 * `famprove.clips.autoLast` → `{ [clip id]: AutoLast }`, written by every analyseClip caller through
 * recordRun, aborted runs included, so a hang or a hidden page shows in the debug panel's log. Never
 * sent to the server. Storage is injected (the auto-version.ts pattern), so node tests it.
 */
import type { AutoOutcome } from "./auto-run.ts";
import { type KeyStore, recordIfSaved } from "./auto-version.ts";

export const AUTO_LAST_KEY = "famprove.clips.autoLast";

export type AutoLast = {
  readonly kind: AutoOutcome["kind"];
  readonly mode: string | null;
  readonly why: string | null;
  /** failed only: the step and its message. */
  readonly step?: string;
  readonly message?: string;
  /** low_confidence: its rule; aborted: why. */
  readonly reason?: string;
  readonly runMs: number | null;
  /** Epoch ms. */
  readonly at: number;
};

const KINDS: readonly string[] = ["clipped", "low_confidence", "failed", "aborted", "skipped"];
const str = (v: unknown): v is string => typeof v === "string";

function parseOne(v: unknown): AutoLast | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>; // narrowed per field below
  if (!str(o.kind) || !KINDS.includes(o.kind) || typeof o.at !== "number") return null;
  return {
    kind: o.kind as AutoLast["kind"],
    mode: str(o.mode) ? o.mode : null,
    why: str(o.why) ? o.why : null,
    ...(str(o.step) ? { step: o.step } : {}),
    ...(str(o.message) ? { message: o.message } : {}),
    ...(str(o.reason) ? { reason: o.reason } : {}),
    runMs: typeof o.runMs === "number" ? o.runMs : null,
    at: o.at,
  };
}

/** The stored map; anything unreadable is an empty map, an unreadable entry is left out. */
export function readAutoLast(store: KeyStore | null): Readonly<Record<string, AutoLast>> {
  try {
    const raw = store?.getItem(AUTO_LAST_KEY) ?? null;
    if (raw === null) return {};
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    const out: Record<string, AutoLast> = {};
    for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
      const one = parseOne(e);
      if (one !== null) out[id] = one;
    }
    return out;
  } catch {
    return {};
  }
}

/** The outcome as its stored record. Pure. */
export function lastOf(out: AutoOutcome, at: number): AutoLast {
  if (out.kind === "skipped") return { kind: "skipped", mode: null, why: null, runMs: null, at };
  const base = { kind: out.kind, mode: out.mode?.mode ?? null, why: out.mode?.why ?? null, runMs: out.runMs, at };
  if (out.kind === "failed") return { ...base, step: out.error.step, message: out.error.message };
  if (out.kind === "low_confidence" || out.kind === "aborted") return { ...base, reason: out.reason };
  return base;
}

/** Records clip `id`'s last outcome; a full or blocked storage is ignored. */
export function recordAutoLast(store: KeyStore | null, id: string, out: AutoOutcome, at: number): void {
  try {
    if (store === null) return;
    store.setItem(AUTO_LAST_KEY, JSON.stringify({ ...readAutoLast(store), [id]: lastOf(out, at) }));
  } catch {
    // ignored: an enhancement only
  }
}

/** Every analyseClip caller's one call: the version (only when saved) and the last outcome. */
export function recordRun(store: KeyStore | null, id: string, out: AutoOutcome, at: number): void {
  recordIfSaved(store, id, out);
  recordAutoLast(store, id, out, at);
}

const MONTHS = ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Copenhagen", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "20. okt. 14:02" in Copenhagen time. */
export function whenText(at: number): string {
  const p = Object.fromEntries(TIME.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return `${Number(p.day)}. ${MONTHS[Number(p.month) - 1]} ${p.hour}:${p.minute}`;
}

/** 22 s, or 18 min from a minute on. */
export function runText(ms: number): string {
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

/** The debug log's first line, e.g. "baggrund: failed · trin pose · timeout: over 108 s · afspil · 18 min · 20. okt. 14:02". */
export function lastLine(last: AutoLast | null): string {
  if (last === null) return "baggrund: ingen kørsel endnu";
  const parts: string[] = [last.kind];
  if (last.step !== undefined) {
    const broad = last.step === "model" || last.step === "lift" ? last.step : "pose";
    parts.push(`trin ${broad}`, last.step === broad ? (last.message ?? "") : `${last.step}: ${last.message ?? ""}`);
  }
  if (last.reason !== undefined) parts.push(last.reason);
  if (last.why !== null) parts.push(last.why);
  if (last.runMs !== null) parts.push(runText(last.runMs));
  parts.push(whenText(last.at));
  return `baggrund: ${parts.join(" · ")}`;
}
