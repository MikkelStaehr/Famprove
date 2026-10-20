/**
 * The camera diagnostic at /kamera (slice camera-diag, 2026-10-20): what each camera on the phone
 * offers, as plain text the user copies and sends. Pure, no I/O. Nothing leaves the phone except
 * by the user's own paste: no deviceId or groupId is ever kept, shown or copied (cameras are numbered).
 */
import { formatSeconds } from "./cut-lines.ts";

/** The capability and setting keys the report shows, in this order (camera-wide picks lens, zoom and size from them). */
export const DIAG_KEYS = ["width", "height", "aspectRatio", "frameRate", "zoom", "facingMode", "resizeMode"] as const;

/** Never kept, shown or copied. */
const PRIVATE_KEYS: ReadonlySet<string> = new Set(["deviceId", "groupId"]);

/** One value of MediaTrackCapabilities / MediaTrackSettings: a range, a list, a number, a string or a flag. */
export type DiagValue = number | string | boolean | readonly string[] | { readonly min?: number; readonly max?: number; readonly step?: number };

export type DiagRecord = Readonly<Partial<Record<(typeof DIAG_KEYS)[number], DiagValue>>>;

/** A step's outcome: the settings it got, or the error's name and message. */
export type DiagOutcome = { readonly ok: true; readonly settings: DiagRecord } | { readonly ok: false; readonly error: string };

export type CameraResult = {
  readonly index: number; // 1-based, in enumerateDevices order
  readonly label: string; // "" when the browser gives none
  readonly open: DiagOutcome; // getSettings() right after opening by deviceId
  readonly capabilities: DiagRecord | null; // null: getCapabilities() missing or failed
  readonly otherCapabilities: readonly string[]; // the remaining capability names (no values), private keys left out
  readonly tries: readonly { readonly name: string; readonly outcome: DiagOutcome }[]; // 960×720, 1280×720
  readonly zoomMin: DiagOutcome | null; // null: zoom not supported
  readonly shot: { readonly width: number; readonly height: number } | { readonly error: string } | null; // null: not tried
};

function isRange(v: unknown): v is { min?: number; max?: number; step?: number } {
  return typeof v === "object" && v !== null && !Array.isArray(v) && ("min" in v || "max" in v);
}

function asValue(v: unknown): DiagValue | undefined {
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (isRange(v)) {
    const r: { min?: number; max?: number; step?: number } = {};
    if (typeof v.min === "number") r.min = v.min;
    if (typeof v.max === "number") r.max = v.max;
    if (typeof v.step === "number") r.step = v.step;
    return r;
  }
  return undefined;
}

/** The DIAG_KEYS of a capabilities or settings object (unknown: it comes from the browser). */
export function pickDiag(source: unknown): DiagRecord {
  const out: Partial<Record<(typeof DIAG_KEYS)[number], DiagValue>> = {};
  if (typeof source !== "object" || source === null) return out;
  const rec = source as Record<string, unknown>; // a browser dictionary; only DIAG_KEYS are read
  for (const key of DIAG_KEYS) {
    const v = asValue(rec[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Capability names outside DIAG_KEYS, sorted, without deviceId and groupId. */
export function otherKeys(source: unknown): string[] {
  if (typeof source !== "object" || source === null) return [];
  const shown: ReadonlySet<string> = new Set(DIAG_KEYS);
  return Object.keys(source)
    .filter((k) => !shown.has(k) && !PRIVATE_KEYS.has(k))
    .sort();
}

/** Whether a capabilities record offers zoom (a range with a min). */
export function zoomMinOf(caps: DiagRecord | null): number | null {
  const z = caps?.zoom;
  return isRange(z) && typeof z.min === "number" ? z.min : null;
}

/** An error as "Name: message" (never the stack). */
export function errorText(error: unknown): string {
  if (error instanceof Error || (typeof error === "object" && error !== null && "name" in error)) {
    const e = error as { name?: unknown; message?: unknown };
    const name = typeof e.name === "string" ? e.name : "Error";
    const message = typeof e.message === "string" && e.message !== "" ? `: ${e.message}` : "";
    return `${name}${message}`;
  }
  return String(error);
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

/** One value as text: a range "min–max (trin s)", a list joined, a number up to 3 decimals. */
export function formatValue(v: DiagValue): string {
  if (typeof v === "number") return num(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "ja" : "nej";
  if (Array.isArray(v)) return v.length === 0 ? "–" : v.join(", ");
  const r = v as { min?: number; max?: number; step?: number };
  const span = `${r.min === undefined ? "?" : num(r.min)}–${r.max === undefined ? "?" : num(r.max)}`;
  return r.step === undefined ? span : `${span} (trin ${num(r.step)})`;
}

/** A settings record on one line: "960×720 · 4:3 (1.333) · 30 fps · zoom 1 · environment · none". */
export function settingsLine(s: DiagRecord): string {
  const parts: string[] = [];
  if (typeof s.width === "number" && typeof s.height === "number") {
    parts.push(`${s.width}×${s.height}`);
    parts.push(`${aspectName(s.width, s.height)} (${num(s.width / s.height)})`);
  } else if (s.aspectRatio !== undefined) parts.push(`aspekt ${formatValue(s.aspectRatio)}`);
  if (s.frameRate !== undefined) parts.push(`${formatValue(s.frameRate)} fps`);
  if (s.zoom !== undefined) parts.push(`zoom ${formatValue(s.zoom)}`);
  if (s.facingMode !== undefined) parts.push(formatValue(s.facingMode));
  if (s.resizeMode !== undefined) parts.push(`resize ${formatValue(s.resizeMode)}`);
  return parts.length === 0 ? "ingen indstillinger" : parts.join(" · ");
}

/** 4:3, 16:9, 1:1 or the reduced ratio (either orientation). */
export function aspectName(width: number, height: number): string {
  if (width <= 0 || height <= 0) return "?";
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Math.round(width), Math.round(height));
  return `${Math.round(width) / g}:${Math.round(height) / g}`;
}

function outcomeLine(o: DiagOutcome): string {
  return o.ok ? settingsLine(o.settings) : `fejl · ${o.error}`;
}

/** One camera's text block (the card shows it; formatReport joins them). */
export function formatCamera(c: CameraResult): string {
  const lines: string[] = [`Kamera ${c.index} · ${c.label === "" ? "(intet navn)" : c.label}`];
  lines.push(`  Åbnet: ${outcomeLine(c.open)}`);
  if (c.capabilities === null) lines.push("  Kan: getCapabilities findes ikke");
  else {
    lines.push("  Kan:");
    for (const key of DIAG_KEYS) {
      const v = c.capabilities[key];
      lines.push(`    ${key}: ${v === undefined ? "–" : formatValue(v)}`);
    }
    if (c.otherCapabilities.length > 0) lines.push(`    andet: ${c.otherCapabilities.join(", ")}`);
  }
  for (const t of c.tries) lines.push(`  ${t.name}: ${outcomeLine(t.outcome)}`);
  lines.push(`  Zoom min: ${c.zoomMin === null ? "zoom understøttes ikke" : outcomeLine(c.zoomMin)}`);
  const shot = c.shot === null ? "ikke taget" : "error" in c.shot ? `fejl · ${c.shot.error}` : `${c.shot.width}×${c.shot.height}`;
  lines.push(`  Testbillede: ${shot}`);
  return lines.join("\n");
}

/** Everything Kopiér alt copies: a header, then one block per camera. */
export function formatReport(cameras: readonly CameraResult[], at: Date): string {
  const stamp = at.toISOString().slice(0, 16).replace("T", " ");
  const head = `Kameratest · ${stamp} UTC · ${cameras.length} ${cameras.length === 1 ? "kamera" : "kameraer"}`;
  return [head, ...cameras.map(formatCamera)].join("\n\n");
}

/** A media track as far as the cleanup needs it. */
export type StoppableTrack = { stop(): void };

/**
 * The open tracks and blob URLs of one run. release() stops every track and revokes every URL
 * (unmount, page hidden, back); after it, anything added is stopped or revoked at once, so a run
 * still awaiting a camera never leaves one open.
 */
export function diagResources(revoke: (url: string) => void) {
  let tracks: StoppableTrack[] = [];
  let urls: string[] = [];
  let released = false;
  const stopTracks = () => {
    for (const t of tracks) t.stop();
    tracks = [];
  };
  return {
    get released(): boolean {
      return released;
    },
    /** Keeps the stream's tracks; false (and stopped) after release. */
    addTracks(list: readonly StoppableTrack[]): boolean {
      if (released) {
        for (const t of list) t.stop();
        return false;
      }
      tracks.push(...list);
      return true;
    },
    /** Stops the open tracks (before the next camera opens: one at a time). */
    stopTracks,
    /** Keeps a blob URL; false (and revoked) after release. */
    addUrl(url: string): boolean {
      if (released) {
        revoke(url);
        return false;
      }
      urls.push(url);
      return true;
    },
    release(): void {
      released = true;
      stopTracks();
      for (const u of urls) revoke(u);
      urls = [];
    },
  };
}

export type DiagResources = ReturnType<typeof diagResources>;

/** Pose landmarks counted as "a joint seen": elbows, wrists, hips and knees (MediaPipe's 33-point indices). */
export const SEEN_JOINTS: readonly number[] = [13, 14, 15, 16, 23, 24, 25, 26];
/** A landmark counts as seen from this visibility. */
export const SEEN_VISIBILITY = 0.5;

/** One frame as the pose line needs it: the landmarks' (x, y, visibility), or null when no person was found. */
export type PoseFrameLike = { readonly landmarks: readonly (readonly [number, number, number])[] | null };

/** The share (0–1) of frames with at least one hip, knee, wrist or elbow at visibility ≥ 0.5; null for no frames. */
export function jointsSeenShare(frames: readonly PoseFrameLike[]): number | null {
  if (frames.length === 0) return null;
  const seen = frames.filter((f) => f.landmarks !== null && SEEN_JOINTS.some((i) => (f.landmarks?.[i]?.[2] ?? 0) >= SEEN_VISIBILITY));
  return seen.length / frames.length;
}

/** Kameratest's pose outcome: the timing of a run, or why it failed (a short reason). */
export type PoseOutcome =
  | {
      readonly ok: true;
      readonly timing: { readonly loadMs: number; readonly frames: number; readonly msPerFrame: number; readonly totalMs: number };
      readonly seenShare: number | null;
    }
  | { readonly ok: false; readonly reason: string };

/** `Pose: 20 billeder på 1,4 s (70 ms pr. billede, indlæsning 2,1 s) · led set i 85 % af billederne (hofte, knæ, håndled eller albue)`, or the failure line. */
export function poseLine(o: PoseOutcome): string {
  if (!o.ok) return `Pose kunne ikke køre (${o.reason})`;
  const { frames, totalMs, msPerFrame, loadMs } = o.timing;
  const seen = o.seenShare === null ? "" : ` · led set i ${Math.round(o.seenShare * 100)} % af billederne (hofte, knæ, håndled eller albue)`;
  return `Pose: ${frames} ${frames === 1 ? "billede" : "billeder"} på ${formatSeconds(totalMs / 1000)} (${Math.round(msPerFrame)} ms pr. billede, indlæsning ${formatSeconds(loadMs / 1000)})${seen}`;
}

/** A failure's short reason for the pose line: at most 60 characters, never a stack. */
export function poseReason(error: unknown): string {
  const text = typeof error === "object" && error !== null && "reason" in error && "message" in error && typeof error.message === "string" ? error.message : errorText(error);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}
