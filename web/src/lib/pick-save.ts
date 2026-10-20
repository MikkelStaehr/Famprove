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
