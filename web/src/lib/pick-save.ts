/**
 * A superset pick's save as pure decisions (slice superset-any, spec rule 11–12; as lib/jump-save):
 * the pick is saved like a jump through the same queue (halts(), jump-save.ts). The client orders
 * only by stored choices: a pick that failed or was refused puts the stored order back at once.
 */
import type { SaveOutcome } from "./jump-save.ts";
import type { JumpMark } from "./set-taps.ts";
import type { SupersetResult } from "./supersets.ts";

/** The action's reply as the queue's outcome (a throw or no reply is "failed"). */
export function pickOutcome(result: SupersetResult | null): SaveOutcome {
  if (result === null) return "failed";
  if (result.ok) return "saved";
  if (result.reason === "dev") return "dev";
  return result.reason === "failed" ? "failed" : "refused";
}

/** The run order in force after the pick's save and the line to show (null = none). */
export function pickAfter(
  outcome: SaveOutcome,
  stored: readonly number[] | null,
  picked: readonly number[] | null,
): { readonly runRows: readonly number[] | null; readonly line: "failed" | "refused" | null } {
  switch (outcome) {
    case "saved":
    case "dev":
      return { runRows: picked, line: null };
    case "failed":
      return { runRows: stored, line: "failed" };
    case "refused":
      return { runRows: stored, line: "refused" };
  }
}

/**
 * The order and undo mark after a landed pick: the pick's order, no jump mark. The server clears
 * previous_rows / jumped_at / moved_start in the same upsert, so a Fortryd afterwards undoes the
 * done before the jump, never the pick (client = server).
 */
export function pickedShape<S extends { readonly runRows: readonly number[] | null; readonly jump?: JumpMark | null }>(shape: S, runRows: readonly number[] | null): S {
  return { ...shape, runRows, jump: null };
}

/**
 * The order after a failed or refused pick while later taps are held (review 2026-10-20): the
 * stored order with the held taps' order effects kept. `current` is the order on screen now (the
 * pick's, then any held jump's); unchanged since the pick = nothing held moved a run: the stored
 * order. Else only the pick is undone: B leaves its seat after A and goes back before the run that
 * followed it in the stored order (the end if none), unless a held tap moved B itself (B no longer
 * right after A): then the held order stays as it is until it is sent.
 */
export function unpickOrder(
  stored: readonly number[] | null,
  picked: readonly number[],
  current: readonly number[] | null,
  rowA: number,
  rowB: number,
): readonly number[] | null {
  if (current === null || sameRows(current, picked)) return stored;
  const at = current.indexOf(rowB);
  if (at < 1 || current[at - 1] !== rowA) return current;
  const base = stored ?? picked;
  const after = base.indexOf(rowB);
  const successor = after < 0 ? undefined : base.slice(after + 1).find((r) => r !== rowA);
  const rest = current.filter((r) => r !== rowB);
  const to = successor === undefined ? -1 : rest.indexOf(successor);
  return to < 0 ? [...rest, rowB] : [...rest.slice(0, to), rowB, ...rest.slice(to)];
}

function sameRows(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i]);
}
