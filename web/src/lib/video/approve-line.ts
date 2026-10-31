/**
 * Godkend auto-klip on the Optagelser line (design/specs/clip-approve-all.md): the button's words,
 * the batch's line per state and its announcements. Pure; the batch itself is approve-all.ts, run by
 * ClipLibrary.
 */
import { formatBytes } from "./space.ts";

/** The line's batch state; idle = no line. */
export type ApproveState =
  | { readonly kind: "idle" }
  /** §2: cutting; `k` = the clip being cut (1-based). */
  | { readonly kind: "busy"; readonly k: number; readonly total: number }
  /** §3: Fortryd's window (`failed` = clips that stayed whole). */
  | { readonly kind: "window"; readonly batch: string; readonly ids: readonly string[]; readonly deadline: string; readonly failed: number }
  /** §3: nothing could be cut; Prøv igen. */
  | { readonly kind: "allFailed"; readonly total: number }
  /** §3 at 0: `freed` measured at render; null = not measured (no MB part). */
  | { readonly kind: "finished"; readonly count: number; readonly freed: number | null }
  /** §4. */
  | { readonly kind: "undone"; readonly count: number };

export const APPROVE_IDLE: ApproveState = { kind: "idle" };

/** §1: `Godkend auto-klip · 3`. */
export function approveLabel(n: number): string {
  return `Godkend auto-klip · ${n}`;
}

/** §2: `Klipper 2 af 3 …`. */
export function approveBusyLabel(k: number, total: number): string {
  return `Klipper ${k} af ${total} …`;
}

/** §1/§5: the button shows only with the switch on and N > 0, or while its own batch runs (it keeps its place). */
export function approveShown(autoOn: boolean, n: number, state: ApproveState): boolean {
  return state.kind === "busy" || (autoOn && n > 0);
}

/** The count row 2 gets for the button (lineParts' `approve`); 0 = hidden. */
export function approveCount(autoOn: boolean, n: number, state: ApproveState): number {
  if (state.kind === "busy") return state.total;
  return approveShown(autoOn, n, state) ? n : 0;
}

/** §2: the progress after `done` + `failed` clips: the next clip being cut, never past the total. */
export function busyAfter(done: number, failed: number, total: number): ApproveState {
  return { kind: "busy", k: Math.min(done + failed + 1, total), total };
}

/** §2: the one polite announcement at the start. */
export function approveStartAnnouncement(total: number): string {
  return `Klipper ${total} klip.`;
}

/** §3: the window's words before Fortryd (all cut, or some failed). */
export function approveWindowText(done: number, failed: number): string {
  return failed === 0 ? `${done} klip klippet · ` : `${done} klip klippet, ${failed} kunne ikke klippes · `;
}

/** §3: the one announcement at done. */
export function approveDoneAnnouncement(done: number): string {
  return `${done} klip klippet. Fortryd muligt i 10 sekunder.`;
}

/** §3 all failed (followed by Prøv igen). */
export function approveAllFailedLine(total: number): string {
  return total === 1 ? "Kunne ikke klippe klippet. Videoen er urørt." : `Kunne ikke klippe de ${total} klip. Videoerne er urørte.`;
}

/** §3 at 0: `3 klip klippet · 42 MB frigjort.`; no MB part when not measured. */
export function approveFinishedLine(count: number, freed: number | null): string {
  const mb = freed === null ? null : formatBytes(freed);
  return mb === null ? `${count} klip klippet.` : `${count} klip klippet · ${mb} frigjort.`;
}

/** §4. */
export function approveUndoneLine(count: number): string {
  return `Fortrudt · ${count} klip er hele igen.`;
}

/** The line's text for a state (the window's text excludes Fortryd); null = no line. */
export function approveLineText(s: ApproveState): string | null {
  switch (s.kind) {
    case "idle":
    case "busy":
      return null;
    case "window":
      return approveWindowText(s.ids.length, s.failed);
    case "allFailed":
      return approveAllFailedLine(s.total);
    case "finished":
      return approveFinishedLine(s.count, s.freed);
    case "undone":
      return approveUndoneLine(s.count);
  }
}

/** The result of approveAll as the line's next state. */
export function approveResultState(r: { readonly batch: string; readonly done: readonly string[]; readonly failed: readonly unknown[]; readonly deadline: string | null }): ApproveState {
  if (r.done.length === 0 || r.deadline === null) return { kind: "allFailed", total: r.failed.length };
  return { kind: "window", batch: r.batch, ids: r.done, deadline: r.deadline, failed: r.failed.length };
}
