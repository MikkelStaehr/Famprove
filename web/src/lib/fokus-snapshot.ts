/**
 * Fokus › Minimér's snapshot (design/specs/fokus-minimise.md §2): what the minimised bar shows
 * outside Fokus, written to sessionStorage on every tap and read by the bar. Pure, so it is tested
 * without the DOM (tests/fokus-snapshot.test.ts). Local only: nothing here is sent anywhere.
 * Every storage call is wrapped (private mode, quota, a disabled store): a failure is no bar,
 * never a thrown error. An unreadable snapshot is discarded; one from another day is cleared.
 */
import { displayName, type FokusView, kgBlock, rangeFigure } from "./fokus-view.ts";
import type { Vibrator } from "./rest-signal.ts";

export const SNAPSHOT_KEY = "fokus-minimised";
/** Dispatched on window after a write in this tab (sessionStorage fires no storage event in its own tab). */
export const SNAPSHOT_EVENT = "fokus-snapshot";

export type FokusSnapshot = {
  readonly date: string; // the session's date (YYYY-MM-DD)
  readonly session: number;
  /** The next set: the variant's display name, its number in the run, the reps figure and today's kg (null = no kg). */
  readonly next: { readonly name: string; readonly n: number; readonly reps: string | null; readonly kg: string | null };
  /** The rest's start (the latest done tap), null without a rest (a warm-up, set 1 not begun). */
  readonly restSince: string | null;
  readonly restMinS: number | null;
  readonly restMaxS: number | null;
  /** The rest start whose minimum already vibrated (Fokus or the bar): never twice. */
  readonly signalled: string | null;
};

/** The part of `Storage` used here. */
export type SnapshotStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The snapshot for Fokus's view, or null when there is nothing to come back to: the session not
 * begun, finished (every set done or skipped), or the next set unknown. `signalled` carries over
 * from the previous snapshot while the rest is the same.
 */
export function snapshotOf(
  date: string,
  session: number,
  view: FokusView,
  begun: boolean,
  previous: FokusSnapshot | null = null,
): FokusSnapshot | null {
  if (!begun || view.kind === "finished" || view.shown === null) return null;
  const e = view.shown.exercise;
  const kg = kgBlock(e);
  const rest = view.kind === "set" ? view.rest : null;
  const window = view.kind === "set" ? view.restWindow : null;
  const restSince = rest?.since ?? null;
  return {
    date,
    session,
    next: {
      name: displayName(e),
      n: view.shown.number,
      reps: e.repsText === null || !/\d/.test(e.repsText) ? null : rangeFigure(e.repsText),
      kg: kg !== null && kg.unit === "kg" ? kg.figure : null,
    },
    restSince,
    restMinS: window?.minS ?? null,
    restMaxS: window?.maxS ?? null,
    signalled: carriedSignal(restSince, previous),
  };
}

/** The "already signalled" mark carried over from `previous` while the rest is the same one, else null. */
export function carriedSignal(restSince: string | null, previous: FokusSnapshot | null): string | null {
  return previous !== null && restSince !== null && previous.signalled === restSince ? restSince : null;
}

function isSnapshot(x: unknown): x is FokusSnapshot {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>; // parsed JSON: every field checked below
  const n = s.next as Record<string, unknown> | null | undefined;
  const strOrNull = (v: unknown) => v === null || typeof v === "string";
  const numOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
  return (
    typeof s.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s.date) &&
    typeof s.session === "number" &&
    typeof n === "object" &&
    n !== null &&
    typeof n.name === "string" &&
    typeof n.n === "number" &&
    strOrNull(n.reps) &&
    strOrNull(n.kg) &&
    strOrNull(s.restSince) &&
    (s.restSince === null || Number.isFinite(Date.parse(s.restSince as string))) &&
    numOrNull(s.restMinS) &&
    numOrNull(s.restMaxS) &&
    strOrNull(s.signalled)
  );
}

/** Writes the snapshot, or clears it for null. A store that fails is ignored (no bar). */
export function writeSnapshot(store: SnapshotStore | null | undefined, snap: FokusSnapshot | null): void {
  try {
    if (store == null) return;
    if (snap === null) store.removeItem(SNAPSHOT_KEY);
    else store.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    // private mode / quota: the bar is an enhancement only
  }
}

/** The snapshot for `today`, else null: an unreadable one is discarded, one from another day cleared. */
export function readSnapshot(store: SnapshotStore | null | undefined, today: string): FokusSnapshot | null {
  try {
    if (store == null) return null;
    const raw = store.getItem(SNAPSHOT_KEY);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (!isSnapshot(parsed) || parsed.date !== today) {
      store.removeItem(SNAPSHOT_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Who writes the snapshot on a log change: Fokus (creates it), Træning's checklist (only updates or
 * clears an existing one of its own date and session: only Minimér starts the bar), or nobody once
 * Afslut has cleared it (a refused jump rolling the log back during the flush must not re-write it).
 */
export type SnapshotWriter = "fokus" | "traening" | "closed";

/** What a log change writes: undefined = leave the stored snapshot, null = clear it, else `now` with its signal mark carried. */
export function snapshotChange(
  writer: SnapshotWriter,
  stored: FokusSnapshot | null,
  date: string,
  session: number,
  now: FokusSnapshot | null,
): FokusSnapshot | null | undefined {
  if (writer === "closed") return undefined;
  if (writer === "traening" && (stored === null || stored.date !== date || stored.session !== session)) return undefined;
  return now === null ? null : { ...now, signalled: carriedSignal(now.restSince, stored) };
}

/** Applies `snapshotChange` to the store; true when it wrote (the caller then tells the bar). */
export function syncSnapshot(
  store: SnapshotStore | null | undefined,
  writer: SnapshotWriter,
  date: string,
  session: number,
  now: FokusSnapshot | null,
): boolean {
  const change = snapshotChange(writer, readSnapshot(store, date), date, session, now);
  if (change === undefined) return false;
  writeSnapshot(store, change);
  return true;
}

/** Minimér after the flush (§2, criterion 2): leave for Træning only when it sent and no set save failed. */
export function minimiseLanding(sent: boolean, failed: number): "leave" | "stay" {
  return sent && failed === 0 ? "leave" : "stay";
}

/** Marks the rest `since` as signalled (its minimum vibrated), so neither Fokus nor the bar buzzes again. */
export function markSignalled(store: SnapshotStore | null | undefined, today: string, since: string): void {
  const snap = readSnapshot(store, today);
  if (snap === null || snap.restSince !== since || snap.signalled === since) return;
  writeSnapshot(store, { ...snap, signalled: since });
}

/** True when the rest `since` already vibrated (by the snapshot's mark). */
export function signalledFor(snap: FokusSnapshot | null, since: string): boolean {
  return snap !== null && snap.signalled === since;
}

/** The bar's middle line: "Næste · Squat · sæt 2 · 5 × 140 kg"; without kg "5 reps"; without reps the name and set only. */
export function nextLine(next: FokusSnapshot["next"]): { readonly name: string; readonly rest: string } {
  const figures = next.reps === null ? (next.kg === null ? "" : ` · ${next.kg} kg`) : next.kg === null ? ` · ${next.reps} reps` : ` · ${next.reps} × ${next.kg} kg`;
  return { name: next.name, rest: ` · sæt ${next.n}${figures}` };
}

/** Minimér's answer (spec §3): refused while the save queue is halted, else flush then leave. */
export function minimiseAction(halted: boolean): "refuse" | "flush" {
  return halted ? "refuse" : "flush";
}

export const MINIMISE_REFUSED = "Kan ikke minimere, før ændringen er gemt. Tryk Gem igen.";

/** The bar's caption by band (§2): "PAUSE · 2–3 MIN", "KLAR · 2–3 MIN", "OVER 3 MIN" (upper case by style). */
export function barCaption(
  band: "none" | "before" | "ready" | "over",
  minutes: { readonly min: string; readonly max: string } | null,
): { readonly icon: "check" | "warning" | null; readonly text: string } {
  const span = minutes === null ? "" : ` · ${minutes.min}–${minutes.max} min`;
  if (band === "ready") return { icon: "check", text: `Klar${span}` };
  if (band === "over" && minutes !== null) return { icon: "warning", text: `Over ${minutes.max} min` };
  return { icon: null, text: `Pause${span}` };
}

/** The stored snapshot as it is, any day (null when absent or unreadable); never removes anything. */
function peek(store: SnapshotStore | null | undefined): FokusSnapshot | null {
  try {
    const raw = store?.getItem(SNAPSHOT_KEY) ?? null;
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The rest signal's vibrator shared by Fokus and the bar (§2 Signal): it vibrates only when the
 * snapshot hasn't marked this rest as signalled, and marks it, so the two never buzz twice.
 */
export function sharedVibrator(store: SnapshotStore | null | undefined, since: string, nav: Vibrator | undefined): Vibrator {
  return {
    vibrate(ms: number) {
      const snap = peek(store);
      if (snap !== null && snap.signalled === since) return false;
      if (snap !== null && snap.restSince === since) writeSnapshot(store, { ...snap, signalled: since });
      return typeof nav?.vibrate === "function" ? nav.vibrate(ms) : false;
    },
  };
}

/** The tab's sessionStorage, or null where it can't be reached (server, disabled storage). */
export function sessionStore(): SnapshotStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
