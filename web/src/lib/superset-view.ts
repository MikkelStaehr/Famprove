/**
 * The supersets' screen rules (spec design/specs/supersets.md; slice supersets), pure: no React,
 * no I/O. Træning's seam (S1–S9): the state per boundary between two runs and the optimistic
 * switch as a reducer. Fokus in a pair (S10–S17): the done label, the rest switch and window, the
 * pair line. The pairs themselves come from lib/supersets.ts (the server's rules).
 */

import { isWarmup, type LoggedSet, type PairRef, runStartRows, type RunSet, sessionOrderWithWarmups, type SetRef, setKey } from "./set-taps.ts";
import { type EffectivePair, type PairSlot, pairSlots, type PairSource, sessionRuns, type SupersetRefusal, type SupersetResult } from "./supersets.ts";
import { type ExerciseView, titleName } from "./training-view.ts";

type Named = Pick<ExerciseView, "name" | "variant" | "variantId" | "row" | "sets">;

/** The session's sets as the run rules read them. */
export function runSetsOf(exercises: readonly Named[]): RunSet[] {
  return exercises.flatMap((e) => e.sets.map((ref) => ({ ref, name: e.name, variantId: e.variantId })));
}

/** The first row of the run `row` is in (null when the row isn't in the session). */
export function runStartOf(exercises: readonly Named[], row: number): number | null {
  if (!exercises.some((e) => e.row === row)) return null;
  const starts = [...runStartRows(runSetsOf(exercises))].filter((r) => r <= row);
  return starts.length === 0 ? null : Math.max(...starts);
}

// ---------------------------------------------------------------- Træning: the seam (S1–S9)

export type SeamState = "available" | "suggested" | "paired" | "locked" | "none";

/** S3: the seam's look per slot. Unpaired and locked (started, or a run in another pair) = no control. */
export function seamState(slot: Pick<PairSlot, "paired" | "source" | "locked">): SeamState {
  if (slot.locked) return slot.paired ? "locked" : "none";
  if (!slot.paired) return "available";
  return slot.source === "suggested" ? "suggested" : "paired";
}

export function slotKey(p: PairRef): string {
  return `${p.rowA}-${p.rowB}`;
}

/** One tap's state per slot: `override` = the user's choice not yet confirmed as stored (null = the server's). */
export type SeamSave = {
  readonly override: boolean | null;
  readonly status: "idle" | "saving" | "failed" | "refused";
  /** Why the server refused (status refused only), for S8's line. */
  readonly reason?: SupersetRefusal;
};

export type SeamEvent =
  | { readonly kind: "tap"; readonly paired: boolean }
  | { readonly kind: "result"; readonly result: SupersetResult | null }; // null = the call threw (offline)

export const SEAM_IDLE: SeamSave = { override: null, status: "idle" };

/**
 * The optimistic switch (S6–S8): a tap changes the state at once; a stored reply keeps it; a lost
 * or failed save keeps it with S7's line and Gem igen; a refusal returns to the stored state (S8).
 */
export function seamReducer(state: SeamSave, event: SeamEvent): SeamSave {
  if (event.kind === "tap") return { override: event.paired, status: "saving" };
  const r = event.result;
  if (r === null || (!r.ok && r.reason === "failed")) return { override: state.override, status: "failed" };
  if (!r.ok && r.reason !== "dev") return { override: null, status: "refused", reason: r.reason };
  return { override: state.override, status: "idle" };
}

/** The pairs in force on the client: the server's, with each slot's unconfirmed choice applied. */
export function clientPairs(
  serverSlots: readonly PairSlot[],
  saves: ReadonlyMap<string, SeamSave>,
): (PairRef & { readonly source: PairSource })[] {
  const out: (PairRef & { readonly source: PairSource })[] = [];
  for (const s of serverSlots) {
    const override = saves.get(slotKey(s))?.override ?? null;
    if (override === null) {
      if (s.paired && s.source !== null) out.push({ rowA: s.rowA, rowB: s.rowB, source: s.source });
    } else if (override) out.push({ rowA: s.rowA, rowB: s.rowB, source: "today" });
  }
  return out;
}

/**
 * The pairs the tap order follows: as clientPairs, but a choice whose save failed is left out
 * until it is stored (reviewer 2026-10-15: the server orders by the stored pairs, so a failed
 * choice in the order would start a different set than NÆSTE shows). The seam still shows it.
 */
export function orderPairs(
  serverSlots: readonly PairSlot[],
  saves: ReadonlyMap<string, SeamSave>,
): (PairRef & { readonly source: PairSource })[] {
  const stored = new Map([...saves].filter(([, v]) => v.status !== "failed"));
  return clientPairs(serverSlots, stored);
}

/** The tap order (S10) for the client's pairs, so NÆSTE and the progress follow a fresh switch. */
export function clientOrder(exercises: readonly Named[], pairs: readonly PairRef[]): SetRef[] {
  return sessionOrderWithWarmups(runSetsOf(exercises), pairs);
}

export type SeamView = {
  readonly rowA: number;
  readonly rowB: number;
  readonly state: SeamState;
  readonly nameA: string;
  readonly nameB: string;
  /** "Bench og Pull-ups" (variant display names when set). */
  readonly both: string;
  /** Locked: the run that started ("Bench"), for S9's locked sentence and S8's refusal. */
  readonly started: string;
};

/**
 * Each offered boundary (the server's slots: both runs have an exercise id) re-read against the
 * client's pairs and log, so a tick or a fresh switch locks or frees a seam without a reload.
 */
export function seamViews(
  exercises: readonly Named[],
  serverSlots: readonly PairSlot[],
  pairs: readonly (PairRef & { readonly source: PairSource })[],
  log: Iterable<SetRef | LoggedSet>,
): SeamView[] {
  const logged = [...log];
  // Every run gets a placeholder id: the server already dropped the boundaries without one.
  const runs = sessionRuns(runSetsOf(exercises), new Map(exercises.map((e) => [e.name.trim().toLowerCase(), 1])));
  const effective: EffectivePair[] = pairs.map((p) => ({ rowA: p.rowA, rowB: p.rowB, source: p.source }));
  const offered = new Set(serverSlots.map(slotKey));
  const nameOf = (row: number) => {
    const e = exercises.find((x) => x.row === row);
    return e === undefined ? "" : titleName(e);
  };
  return pairSlots(runs, effective, logged)
    .filter((s) => offered.has(slotKey(s)))
    .map((s) => {
      const a = runs.find((r) => r.row === s.rowA);
      const aStarted = a !== undefined && logged.some((l) => a.rows.includes(l.row) && !(l.row === a.row && l.set === 0));
      const nameA = nameOf(s.rowA);
      const nameB = nameOf(s.rowB);
      return { rowA: s.rowA, rowB: s.rowB, state: seamState(s), nameA, nameB, both: `${nameA} og ${nameB}`, started: aStarted ? nameA : nameB };
    });
}

/** S9: the polite status after a tap. */
export function seamSentence(v: Pick<SeamView, "both">, paired: boolean): string {
  return paired ? `${v.both} tages som superset.` : `${v.both} tages hver for sig.`;
}

/** S8: the refusal's line, per the server's reason. */
export function refusedText(v: Pick<SeamView, "started">, reason?: SupersetRefusal): string {
  switch (reason) {
    case "overlap":
      return "Supersettet kan ikke vælges, fordi en af øvelserne allerede er i et andet superset.";
    case "not_today":
      return "Supersettet kan kun ændres på dagen.";
    case "invalid":
    case "no_session":
    case "not_consecutive":
      return "Supersettet kan ikke ændres. Planen er ændret; genindlæs siden.";
    default:
      return `Supersettet kan ikke ændres, fordi ${v.started} er gået i gang.`;
  }
}

// ---------------------------------------------------------------- Fokus in a pair (S10–S17)

type FokusRow = Named & Pick<ExerciseView, "restMinS" | "restMaxS">;

export type PairRole = {
  readonly role: "a" | "b";
  readonly partner: FokusRow; // the partner run's first row
  readonly partnerRows: readonly number[];
  /** The set is past the partner run's last set (S16): it runs alone. */
  readonly solo: boolean;
};

function runRows(exercises: readonly Named[], start: number): number[] {
  const starts = runStartRows(runSetsOf(exercises));
  const rows = exercises.map((e) => e.row).toSorted((a, b) => a - b);
  const out: number[] = [];
  for (const r of rows) {
    if (r < start) continue;
    if (r !== start && starts.has(r)) break;
    out.push(r);
  }
  return out;
}

/** The set's position in its run (warm-up = 0) and the run's set count. */
function runIndex(exercises: readonly Named[], rows: readonly number[], ref: SetRef): number {
  if (ref.set === 0) return 0;
  const sets = rows.flatMap((r) => exercises.find((e) => e.row === r)?.sets ?? []);
  return sets.findIndex((s) => setKey(s) === setKey(ref)) + 1;
}

function runCount(exercises: readonly Named[], rows: readonly number[]): number {
  return rows.reduce((n, r) => n + (exercises.find((e) => e.row === r)?.sets.length ?? 0), 0);
}

/** The set's place in a pair, or null when its run isn't paired. */
export function pairRole(exercises: readonly FokusRow[], pairs: readonly PairRef[], ref: SetRef): PairRole | null {
  const start = runStartOf(exercises, ref.row);
  if (start === null) return null;
  const pair = pairs.find((p) => p.rowA === start || p.rowB === start);
  if (pair === undefined) return null;
  const role = pair.rowA === start ? "a" : "b";
  const partnerStart = role === "a" ? pair.rowB : pair.rowA;
  const partner = exercises.find((e) => e.row === partnerStart);
  if (partner === undefined) return null;
  const partnerRows = runRows(exercises, partnerStart);
  const solo = runIndex(exercises, runRows(exercises, start), ref) > runCount(exercises, partnerRows);
  return { role, partner, partnerRows, solo };
}

/**
 * Whether `next` is `after`'s paired B, straight after it (A → B: no rest, no timer; S13). Working
 * sets only: warm-ups are not part of the superset (user, 2026-10-16), so A0 → B0 is two solo sets.
 */
export function pairHandOff(exercises: readonly FokusRow[], pairs: readonly PairRef[], after: SetRef, next: SetRef): boolean {
  if (isWarmup(after) || isWarmup(next)) return false;
  const role = pairRole(exercises, pairs, after);
  return role !== null && role.role === "a" && role.partnerRows.includes(next.row);
}

/** S12: A's done reads "Videre til <B>" when the item after it is B's; null = the usual label. */
export function handOffName(
  exercises: readonly FokusRow[],
  pairs: readonly PairRef[],
  current: SetRef,
  following: SetRef | null,
): string | null {
  if (following === null || !pairHandOff(exercises, pairs, current, following)) return null;
  const b = exercises.find((e) => e.row === following.row);
  return b === undefined ? null : titleName(b);
}

/**
 * R3: the rest after B uses the whole window of the run with the larger rest_max_s (both bounds
 * from it); after any other set (a warm-up, a solo one) the set's own window. Returns the row whose window applies.
 */
export function restWindowOf<E extends FokusRow>(exercises: readonly E[], pairs: readonly PairRef[], after: SetRef): { readonly row: E; readonly superset: boolean } | null {
  const own = exercises.find((e) => e.row === after.row);
  if (own === undefined) return null;
  const role = pairRole(exercises, pairs, after);
  if (isWarmup(after) || role === null || role.role !== "b" || role.solo) return { row: own, superset: false };
  const partner = exercises.find((e) => e.row === role.partner.row);
  if (partner === undefined) return { row: own, superset: true };
  const larger = (partner.restMaxS ?? -1) > (own.restMaxS ?? -1) ? partner : own;
  return { row: larger, superset: true };
}

/** S12: A's done, "Videre til Pull-ups"; spoken "Videre til Pull-ups, sæt 2 af 4 udført, Bench" (a working set only). */
export function handOffLabel(
  bName: string,
  done: { readonly number: number; readonly count: number },
  aName: string,
): { readonly visible: string; readonly spoken: string } {
  return { visible: `Videre til ${bName}`, spoken: `Videre til ${bName}, sæt ${done.number} af ${done.count} udført, ${aName}` };
}

/** S11 / S16: the line under the name stack, null outside a pair and on a warm-up (it runs alone). */
export function pairLine(exercises: readonly FokusRow[], pairs: readonly PairRef[], ref: SetRef): string | null {
  if (isWarmup(ref)) return null;
  const role = pairRole(exercises, pairs, ref);
  if (role === null) return null;
  const other = titleName(role.partner);
  if (role.solo) return `Alene – ${other} er færdig`;
  return role.role === "a" ? `Superset med ${other} · den følger uden pause` : `Superset med ${other} · pause bagefter`;
}
