/**
 * The recording strip's state machine and copy (slice video-record, design/specs/video-record.md).
 * Pure: the Fokus hook (components/fokus/useClipRecorder.ts) dispatches events and renders the
 * state; nothing here touches the camera, OPFS or the set log.
 *
 * idle → requesting → recording → stopping → saved (Stop = done) | afbrudt (cancel, background,
 * space, failure) | limit (15:00 reached: kept, saved with the set's done). denied: the camera is
 * blocked (Optag stays, a tap retries).
 */
import { MAX_DURATION_S } from "./clips.ts";

/** §3: below this much free space (quota − usage) the Optag button gives way to a line. */
export const MIN_FREE_MB = 300;

export type AfbrudtReason = "cancel" | "background" | "space" | "failed";

export type RecState =
  | { readonly kind: "idle" }
  | { readonly kind: "requesting" }
  | { readonly kind: "recording"; readonly startedAt: number }
  | { readonly kind: "stopping"; readonly startedAt: number }
  | { readonly kind: "limit"; readonly durationS: number }
  | { readonly kind: "saved"; readonly durationS: number }
  | { readonly kind: "afbrudt"; readonly reason: AfbrudtReason; readonly durationS: number }
  | { readonly kind: "denied" };

export type RecEvent =
  | { readonly type: "optag" }
  | { readonly type: "started"; readonly at: number }
  | { readonly type: "stop" } // Stop = done
  | { readonly type: "stopped"; readonly durationS: number }
  | { readonly type: "limit"; readonly durationS: number }
  | { readonly type: "abort"; readonly reason: AfbrudtReason; readonly durationS: number }
  | { readonly type: "denied" }
  | { readonly type: "clear" }; // the next done or Optag clears a finished line

export const IDLE: RecState = { kind: "idle" };

export function recReducer(state: RecState, event: RecEvent): RecState {
  switch (event.type) {
    case "optag":
      return state.kind === "recording" || state.kind === "stopping" || state.kind === "requesting" ? state : { kind: "requesting" };
    case "started":
      return state.kind === "requesting" ? { kind: "recording", startedAt: event.at } : state;
    case "stop":
      return state.kind === "recording" ? { kind: "stopping", startedAt: state.startedAt } : state;
    case "stopped":
      return state.kind === "stopping" || state.kind === "limit" ? { kind: "saved", durationS: clampDuration(event.durationS) } : state;
    case "limit":
      return state.kind === "recording" ? { kind: "limit", durationS: clampDuration(event.durationS) } : state;
    case "abort":
      return state.kind === "requesting" || state.kind === "recording" || state.kind === "stopping"
        ? { kind: "afbrudt", reason: event.reason, durationS: clampDuration(event.durationS) }
        : state;
    case "denied":
      return state.kind === "requesting" || state.kind === "idle" ? { kind: "denied" } : state;
    case "clear":
      return state.kind === "recording" || state.kind === "stopping" || state.kind === "requesting" ? state : IDLE;
  }
}

function clampDuration(s: number): number {
  return Math.min(MAX_DURATION_S, Math.max(0, s));
}

/** The recorder owns the camera: Spring over, Fortryd and the bar are locked (§7). */
export function isLive(state: RecState): boolean {
  return state.kind === "requesting" || state.kind === "recording" || state.kind === "stopping";
}

/** The dock's one light button reads Stop while the clip runs (§7). */
export function stopInDock(state: RecState): boolean {
  return state.kind === "recording";
}

/** "0:48", "15:00": m:ss, whole seconds. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** §14: what stopped, the kept part (or "Intet blev gemt." under 1 s), and that the set is not done. */
export function afbrudtLine(reason: AfbrudtReason, durationS: number): string {
  const kept = durationS < 1 ? "Intet blev gemt." : `${clock(durationS)} er gemt som afbrudt${reason === "background" ? " under Optagelser" : ""}.`;
  const what =
    reason === "space"
      ? "Optagelsen stoppede: telefonen løb tør for plads."
      : reason === "background"
        ? "Optagelsen blev afbrudt, da appen gik i baggrunden."
        : reason === "failed"
          ? "Optagelsen stoppede: kameraet svarede ikke."
          : "Optagelsen er annulleret.";
  return `${what} ${kept} Sættet er ikke markeret udført.`;
}

export const LIMIT_LINE = "Optagelsen stoppede ved 15:00. Den gemmes med sættet.";
export const LOW_SPACE_LINE = `Ikke plads til video: under ${MIN_FREE_MB} MB ledigt. Slet optagelser under Træning.`;
export const DENIED_TITLE = "Kameraet er blokeret for Famprove.";
export const DENIED_HELP = "Tillad det i Chrome: ⋮ › Indstillinger › Webstedsindstillinger › Kamera. Sættet kan stadig markeres udført.";
export const WAITING_LABEL = "Venter på kamera …";

/** §15: names that start with the visible words. `setNo` is the shown set number. */
export function optagName(setNo: number, exercise: string): string {
  return `Optag sæt ${setNo}, ${exercise}`;
}
export function recordingStatus(setNo: number): string {
  return `Optager sæt ${setNo}.`;
}
export function stopVisible(doneVisible: string): string {
  return `Stop · ${doneVisible}`;
}
export function stopSpoken(doneSpoken: string): string {
  return `Stop, ${doneSpoken.charAt(0).toLowerCase()}${doneSpoken.slice(1)}`;
}
/** The done status's prefix after Stop: "Video gemt, 48 sekunder. ". */
export function savedPrefix(durationS: number): string {
  const s = Math.max(1, Math.round(durationS));
  return `Video gemt, ${s} ${s === 1 ? "sekund" : "sekunder"}. `;
}

/** Free space under the minimum (§3); an unreadable estimate is not low (null = unknown, the button stays). */
export function lowSpace(estimate: { readonly usage?: number; readonly quota?: number } | null): boolean {
  if (estimate === null || estimate.usage === undefined || estimate.quota === undefined) return false;
  return estimate.quota - estimate.usage < MIN_FREE_MB * 1_000_000;
}

/**
 * Stop = done (§8, and the brief of 2026-10-17): the recorder is stopped first and its last chunk
 * awaited (at most `capMs`, so the done never hangs on a stuck recorder), then the existing done
 * fires unchanged, then the file is finalised and the row inserted. Returns the finalise promise.
 */
export async function stopThenDone(
  steps: { readonly stopRecorder: () => Promise<void>; readonly done: () => void; readonly finalise: () => Promise<void> },
  capMs = 800,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, capMs);
  });
  try {
    await Promise.race([steps.stopRecorder(), cap]);
  } finally {
    clearTimeout(timer);
  }
  steps.done();
  await steps.finalise();
}
