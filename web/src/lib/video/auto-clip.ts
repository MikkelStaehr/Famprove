/**
 * The automatic clip (slice clip-auto): finds a working set's lift in the pose landmarks of its
 * clip (lib/video/pose-run.ts) and gives the in/out to cut, or low_confidence with a reason (then
 * no cut: "Klip selv"). Pure, runs on the phone; the landmarks never leave it (user, 2026-10-20:
 * an exception to "Python owns all calculations", since the video stays on the phone).
 *
 * Steps: pick one joint pair for the whole series (lower body: hips, else knees; upper body:
 * wrists, else elbows); its y (normalised to the image height, growing downwards) is the signal;
 * gaps up to GAP_MAX_S are interpolated, then a 3-point median and a 3-point mean smooth it; reps
 * are the peaks of one polarity (squat/bench: y rises at the bottom; deadlift: y falls at lockout),
 * the polarity whose count is closest to the expected reps among those whose peaks lie away from
 * rest (AWAY_MIN_SHARE); each rep runs from where the signal
 * leaves its rest band to where it returns (see repBounds); in/out pad the first and last rep.
 */
import type { PoseFrame } from "./pose-run.ts";
import { repsRange } from "../fokus-view.ts";
import { isClipId } from "./clips.ts";

/**
 * Every threshold of the automatic clip, in one place: slice clip-accuracy tunes them against
 * the user's own clips (measured, never guessed in code elsewhere).
 */
export const AUTO_CLIP = {
  /** A landmark counts when MediaPipe's visibility is at least this. */
  VISIBILITY_MIN: 0.5,
  /** Missing frames are interpolated when the seen frames either side are at most this far apart (s). */
  GAP_MAX_S: 0.6,
  /** A rep's peak stands out by at least this share of the signal's p5–p95 range. */
  PROMINENCE_SHARE: 0.4,
  /** Two reps' peaks are at least this far apart (s). */
  PEAK_MIN_GAP_S: 1.0,
  /** Padding before the first rep's start and after the last rep's end (s). */
  PAD_S: 0.5,
  /** The rest band: a rep starts and ends within this share of the range above its local rest level. */
  BAND_SHARE: 0.15,
  /**
   * A polarity counts reps only when its peaks lie at least this share of the range from the
   * median (where the lifter spends most of the clip, at rest): the other polarity's peaks are the
   * returns to rest between reps (one fewer), which must never pass as the reps.
   */
  AWAY_MIN_SHARE: 0.5,
  /** The range's percentiles (robust to a stray frame). */
  RANGE_LOW_P: 0.05,
  RANGE_HIGH_P: 0.95,
  /** low_confidence: fewer frames with the joint seen than this share. */
  VALID_MIN_SHARE: 0.5,
  /** low_confidence: reps found differ from the expected by more than this. */
  COUNT_TOLERANCE: 1,
  /** low_confidence: the joint moves less than this share of the image height (p5–p95). */
  RANGE_MIN: 0.03,
  /** low_confidence: a rep shorter or longer than this (s). */
  REP_MIN_S: 0.6,
  REP_MAX_S: 12,
  /** low_confidence: in/out closer than this (s); the clip editor's shortest range (clip-range MIN_LEN_S). */
  MIN_LEN_S: 1,
} as const;

/** MediaPipe Pose's 33-point indices (left, right). */
const PAIRS = {
  hips: [23, 24],
  knees: [25, 26],
  wrists: [15, 16],
  elbows: [13, 14],
} as const;

export type Joint = keyof typeof PAIRS;
export type LiftFamily = "lower" | "upper";

const JOINTS_OF: Readonly<Record<LiftFamily, readonly [Joint, Joint]>> = {
  lower: ["hips", "knees"],
  upper: ["wrists", "elbows"],
};

export type LowConfidenceReason = "no_reps" | "few_frames" | "flat" | "count" | "rep_length" | "short";

export type AutoClipResult =
  | { readonly status: "clipped"; readonly inS: number; readonly outS: number; readonly reps: number; readonly joint: Joint }
  | { readonly status: "low_confidence"; readonly reason: LowConfidenceReason };

/**
 * The sheet TYPE words that make an exercise lower body. A copy of Python's
 * `domain/planned_sets.LOWER_BODY_WORDS` (the weekly cap's split); tests/lower-body-words.test.ts holds them equal.
 */
export const LOWER_BODY_WORDS: readonly string[] = ["SQUAT", "DEADLIFT", "QUADS", "HAMSTRINGS", "GLUTES", "ADDUCTORS", "CALVES"];

/**
 * Lower when the exercise's parent lift is squat or deadlift (public.exercises.parent_lift, when
 * the caller has it), or its sheet TYPE (e.g. "QUADS/ADDUCTORS") holds a lower-body word as Python
 * splits it (on "/" and spaces); every other exercise is upper.
 */
export function liftFamily(sheetType: string | null, parentLift: string | null = null): LiftFamily {
  const parent = parentLift?.trim().toLowerCase() ?? null;
  if (parent === "squat" || parent === "deadlift") return "lower";
  const words = (sheetType ?? "").toUpperCase().replaceAll("/", " ").split(/\s+/);
  return words.some((w) => LOWER_BODY_WORDS.includes(w)) ? "lower" : "upper";
}

/**
 * The reps the clip should hold: the log's reps_done for the set, else the top of the prescribed
 * range (repsRange: order-free), else a fixed count ("5"), else null (findLift: no_reps).
 */
export function expectedReps(repsDone: number | null | undefined, repsText: string | null): number | null {
  if (typeof repsDone === "number" && Number.isInteger(repsDone) && repsDone >= 1) return repsDone;
  const range = repsRange(repsText);
  if (range !== null) return range.top;
  const fixed = repsText === null ? null : /^\s*(\d+)\s*$/.exec(repsText);
  const n = fixed === null ? null : Number(fixed[1]);
  return n !== null && n >= 1 ? n : null;
}

// --- signal ------------------------------------------------------------------------------------

type Series = (number | null)[];

/** The pair's y per frame: the mean of the side(s) seen; null when neither is. */
function jointSeries(frames: readonly PoseFrame[], joint: Joint): Series {
  const [l, r] = PAIRS[joint];
  return frames.map((f) => {
    const seen = [f.landmarks?.[l], f.landmarks?.[r]].filter((p) => p !== undefined && p[2] >= AUTO_CLIP.VISIBILITY_MIN && Number.isFinite(p[1]));
    return seen.length === 0 ? null : seen.reduce((s, p) => s + p![1], 0) / seen.length;
  });
}

const seenCount = (s: Series): number => s.filter((v) => v !== null).length;

/** Linear fill of a gap whose seen frames either side are at most GAP_MAX_S apart. */
function fillGaps(s: Series, t: readonly number[]): Series {
  const out = [...s];
  let prev = -1;
  for (let i = 0; i < s.length; i++) {
    const v = s[i];
    if (v === null) continue;
    if (prev >= 0 && i - prev > 1 && t[i] - t[prev] <= AUTO_CLIP.GAP_MAX_S + 1e-9) {
      const a = s[prev]!;
      for (let j = prev + 1; j < i; j++) out[j] = a + ((v - a) * (t[j] - t[prev])) / (t[i] - t[prev]);
    }
    prev = i;
  }
  return out;
}

/** A 3-point window over seen values; an edge or a frame next to a gap keeps its own value. */
function smooth3(s: Series, f: (w: readonly [number, number, number]) => number): Series {
  return s.map((v, i) => {
    const a = s[i - 1];
    const b = s[i + 1];
    if (v === null || a === null || a === undefined || b === null || b === undefined) return v;
    return f([a, v, b]);
  });
}

const median3 = (w: readonly [number, number, number]): number => w.toSorted((x, y) => x - y)[1];
const mean3 = (w: readonly [number, number, number]): number => (w[0] + w[1] + w[2]) / 3;

function percentile(sorted: readonly number[], p: number): number {
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

// --- peaks -------------------------------------------------------------------------------------

type Peak = { readonly i: number; readonly prominence: number };

/** Local maxima of z (a plateau gives its middle); both neighbours must be seen. */
function localMaxima(z: Series): number[] {
  const out: number[] = [];
  for (let i = 1; i < z.length - 1; i++) {
    const v = z[i];
    const before = z[i - 1];
    if (v === null || before === null || before >= v) continue;
    let j = i;
    while (j + 1 < z.length && z[j + 1] === v) j++;
    const after = z[j + 1];
    if (after !== null && after !== undefined && after < v) out.push((i + j) >> 1);
    i = j;
  }
  return out;
}

/**
 * A peak's prominence: how far it stands above the higher of its two bases, each base being the
 * lowest point on that side before the signal rises above the peak again, a gap or the end.
 */
function prominence(z: Series, i: number): number {
  const v = z[i]!;
  const base = (step: -1 | 1): number => {
    let min = v;
    for (let j = i + step; j >= 0 && j < z.length; j += step) {
      const w = z[j];
      if (w === null || w > v) break;
      min = Math.min(min, w);
    }
    return min;
  };
  return v - Math.max(base(-1), base(1));
}

/** Peaks at least minProm prominent, then at least PEAK_MIN_GAP_S apart (the more prominent wins); in time order. */
function findPeaks(z: Series, t: readonly number[], minProm: number): Peak[] {
  const candidates = localMaxima(z)
    .map((i) => ({ i, prominence: prominence(z, i) }))
    .filter((p) => p.prominence >= minProm)
    .toSorted((a, b) => b.prominence - a.prominence);
  const kept: Peak[] = [];
  for (const p of candidates) if (kept.every((k) => Math.abs(t[k.i] - t[p.i]) >= AUTO_CLIP.PEAK_MIN_GAP_S - 1e-9)) kept.push(p);
  return kept.toSorted((a, b) => a.i - b.i);
}

/**
 * A rep's start and end around its peak (the signal oriented so the rep is a maximum). The rest
 * level on each side is the lowest point between the peak and its neighbouring peak (or the
 * series' edge, or a gap). Walking out from the peak, the rep leaves (start) or returns to (end)
 * its rest band, BAND_SHARE of the range above that rest level; the crossing is interpolated between
 * frames. The turning point, where the joint began or stopped moving, lies a little further out:
 * the edge through the band crossing and the half-height crossing is extended to the rest level
 * (exact on a steady movement; on one that eases in it lands between the turning point and the band
 * crossing, so never before the lift). It never passes the neighbouring peak, a gap or the edge;
 * a rep that never reaches its band there ends at that limit.
 */
function repBounds(z: Series, t: readonly number[], peaks: readonly Peak[], k: number, range: number): { readonly start: number; readonly end: number } {
  const side = (step: -1 | 1): number => {
    const p = peaks[k].i;
    const top = z[p]!;
    const neighbour = peaks[k + step]?.i;
    let limit = p; // the last seen index on this side, before the neighbouring peak, a gap or the edge
    for (let j = p + step; j >= 0 && j < z.length && j !== neighbour && z[j] !== null; j += step) limit = j;
    let rest = top;
    for (let j = p; j !== limit + step; j += step) rest = Math.min(rest, z[j]!);
    /** The time z first falls to level walking out from the peak (interpolated), or null. */
    const crossing = (level: number): number | null => {
      for (let j = p + step; j !== limit + step; j += step) {
        const a = z[j - step]!;
        const b = z[j]!;
        if (b <= level) return a === b ? t[j] : t[j - step] + ((t[j] - t[j - step]) * (a - level)) / (a - b);
      }
      return null;
    };
    const band = rest + AUTO_CLIP.BAND_SHARE * range;
    const half = rest + (top - rest) / 2;
    const tBand = crossing(band);
    if (tBand === null) return t[limit];
    const tHalf = half > band ? crossing(half) : null;
    const turn = tHalf === null ? tBand : tBand + ((tBand - tHalf) * (band - rest)) / (half - band);
    return step === -1 ? Math.max(t[limit], turn) : Math.min(t[limit], turn);
  };
  return { start: side(-1), end: side(1) };
}

// --- the lift ----------------------------------------------------------------------------------

const low = (reason: LowConfidenceReason): AutoClipResult => ({ status: "low_confidence", reason });
const roundTenth = (s: number): number => Math.round(s * 10) / 10;

/** What findLift saw on the way (clip-debug): every value is null until its step was reached. */
export type LiftTrace = {
  joint: Joint | null;
  /** Frames with the chosen joint seen ÷ frames. */
  validShare: number | null;
  /** The signal's p5–p95 range as a share of the image height. */
  range: number | null;
  /** Peaks found per polarity (+1: y rises, −1: y falls), and the polarity chosen. */
  peaksUp: number | null;
  peaksDown: number | null;
  chosenSign: 1 | -1 | null;
};

/** findLift with its trace; findLift is this function's result, so the debug panel follows the same steps. */
export function traceLift(
  frames: readonly PoseFrame[],
  expected: number | null,
  family: LiftFamily,
  durationS: number,
): { readonly result: AutoClipResult; readonly trace: LiftTrace } {
  const trace: LiftTrace = { joint: null, validShare: null, range: null, peaksUp: null, peaksDown: null, chosenSign: null };
  const done = (result: AutoClipResult) => ({ result, trace });
  if (expected === null || !Number.isInteger(expected) || expected < 1) return done(low("no_reps"));
  if (frames.length === 0 || !Number.isFinite(durationS) || durationS <= 0) return done(low("few_frames"));
  const [first, second] = JOINTS_OF[family];
  const firstSeries = jointSeries(frames, first);
  const secondSeries = jointSeries(frames, second);
  const useSecond = seenCount(secondSeries) > seenCount(firstSeries); // never switched mid-series
  const joint = useSecond ? second : first;
  const raw = useSecond ? secondSeries : firstSeries;
  trace.joint = joint;
  trace.validShare = seenCount(raw) / frames.length;
  if (trace.validShare < AUTO_CLIP.VALID_MIN_SHARE) return done(low("few_frames"));

  const t = frames.map((f) => f.t);
  const y = smooth3(smooth3(fillGaps(raw, t), median3), mean3);
  const sorted = y.filter((v): v is number => v !== null).toSorted((a, b) => a - b);
  const range = percentile(sorted, AUTO_CLIP.RANGE_HIGH_P) - percentile(sorted, AUTO_CLIP.RANGE_LOW_P);
  trace.range = range;
  if (!(range >= AUTO_CLIP.RANGE_MIN)) return done(low("flat"));

  const median = percentile(sorted, 0.5);
  const polarities = ([1, -1] as const).map((sign) => {
    const z = y.map((v) => (v === null ? null : sign * v));
    const peaks = findPeaks(z, t, AUTO_CLIP.PROMINENCE_SHARE * range);
    // The tie-break: reps are excursions away from rest, which holds the median, so the polarity
    // whose peaks lie further from the median wins.
    const away = peaks.length === 0 ? 0 : peaks.reduce((s, p) => s + z[p.i]!, 0) / peaks.length - sign * median;
    return { sign, z, peaks, away };
  });
  trace.peaksUp = polarities[0].peaks.length;
  trace.peaksDown = polarities[1].peaks.length;
  const atRest = (p: { readonly away: number }): number => (p.away >= AUTO_CLIP.AWAY_MIN_SHARE * range ? 0 : 1);
  const [chosen] = polarities.toSorted(
    (a, b) => atRest(a) - atRest(b) || Math.abs(a.peaks.length - expected) - Math.abs(b.peaks.length - expected) || b.away - a.away,
  );
  const { z, peaks } = chosen;
  trace.chosenSign = chosen.sign;
  if (peaks.length === 0 || Math.abs(peaks.length - expected) > AUTO_CLIP.COUNT_TOLERANCE) return done(low("count"));

  const reps = peaks.map((_, k) => repBounds(z, t, peaks, k, range));
  if (reps.some((r) => r.end - r.start < AUTO_CLIP.REP_MIN_S || r.end - r.start > AUTO_CLIP.REP_MAX_S)) return done(low("rep_length"));

  const inS = roundTenth(Math.max(0, reps[0].start - AUTO_CLIP.PAD_S));
  const outS = roundTenth(Math.min(durationS, reps[reps.length - 1].end + AUTO_CLIP.PAD_S));
  if (outS - inS < AUTO_CLIP.MIN_LEN_S - 1e-9) return done(low("short"));
  return done({ status: "clipped", inS, outS, reps: peaks.length, joint });
}

/**
 * The lift in a clip: in/out (s, 0.1) around the reps, or low_confidence with the first reason
 * that applies: no_reps (no expected count), few_frames (the joint seen in < VALID_MIN_SHARE of
 * the frames), flat (it moves < RANGE_MIN of the image height), count (|found − expected| >
 * COUNT_TOLERANCE), rep_length (a rep outside REP_MIN_S–REP_MAX_S), short (in/out < MIN_LEN_S apart).
 */
export function findLift(frames: readonly PoseFrame[], expected: number | null, family: LiftFamily, durationS: number): AutoClipResult {
  return traceLift(frames, expected, family, durationS).result;
}

/** Mean visibility (0–1) of a landmark over the frames with a person; null with none. */
function meanVisibility(frames: readonly PoseFrame[], index: number): number | null {
  const v = frames.flatMap((f) => (f.landmarks?.[index] === undefined ? [] : [f.landmarks[index][2]])).filter(Number.isFinite);
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
}

export type SideVisibility = { readonly l: number | null; readonly r: number | null };

/** The debug panel's aggregates of one clip (clip-debug): no landmark leaves this, only these numbers. */
export type LiftDiagnosis = {
  readonly frames: number;
  readonly personShare: number | null;
  readonly visibility: { readonly hips: SideVisibility; readonly knees: SideVisibility; readonly shoulders: SideVisibility };
  readonly expected: number | null;
  readonly trace: LiftTrace;
  readonly result: AutoClipResult;
};

/** findLift's steps with their values, plus who was seen how well. Pure. */
export function diagnoseLift(frames: readonly PoseFrame[], expected: number | null, family: LiftFamily, durationS: number): LiftDiagnosis {
  const { result, trace } = traceLift(frames, expected, family, durationS);
  const withPerson = frames.filter((f) => f.landmarks !== null);
  const side = (l: number, r: number): SideVisibility => ({ l: meanVisibility(withPerson, l), r: meanVisibility(withPerson, r) });
  return {
    frames: frames.length,
    personShare: frames.length === 0 ? null : withPerson.length / frames.length,
    visibility: { hips: side(23, 24), knees: side(25, 26), shoulders: side(11, 12) },
    expected,
    trace,
    result,
  };
}

// --- the action's input (setClipAuto) ------------------------------------------------------------

/** video_clips.auto_status's set (the column's check constraint). */
export const AUTO_STATUSES = ["clipped", "low_confidence", "failed"] as const;
export type AutoStatus = (typeof AUTO_STATUSES)[number];
/** auto_run_ms's bounds (the column's check constraint): an integer 0 … 1 h. */
export const MAX_RUN_MS = 3_600_000;

/** Exactly what setClipAuto sends: never landmarks, frames or anything about the device. */
export type SetClipAutoInput = {
  readonly id: string;
  readonly status: unknown;
  readonly inS: unknown;
  readonly outS: unknown;
  readonly runMs: unknown;
};

const AUTO_KEYS = ["id", "status", "inS", "outS", "runMs"] as const;

/** The action's shape check: a clip id and exactly these five keys (anything more, e.g. frames, is refused). */
export function parseSetClipAutoInput(raw: unknown): SetClipAutoInput | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>; // narrowed field by field below
  const keys = Object.keys(r);
  if (keys.length !== AUTO_KEYS.length || !AUTO_KEYS.every((k) => k in r)) return null;
  if (!isClipId(r.id)) return null;
  return { id: r.id, status: r.status, inS: r.inS, outS: r.outS, runMs: r.runMs };
}

export type StoredAuto = {
  readonly status: AutoStatus;
  readonly inS: number | null;
  readonly outS: number | null;
  readonly runMs: number;
};

/**
 * The one validation (server and client): status in AUTO_STATUSES; in/out both finite numbers when
 * clipped, both null otherwise; rounded to 0.1, 0 ≤ in < out ≤ the duration (when known: the server
 * reads duration_s); runMs an integer 0 … MAX_RUN_MS. Anything else is null = refused.
 */
export function validateClipAuto(input: Omit<SetClipAutoInput, "id">, durationS: number | null): StoredAuto | null {
  const { status, inS, outS, runMs } = input;
  if (typeof status !== "string" || !(AUTO_STATUSES as readonly string[]).includes(status)) return null;
  if (typeof runMs !== "number" || !Number.isInteger(runMs) || runMs < 0 || runMs > MAX_RUN_MS) return null;
  const s = status as AutoStatus; // checked against AUTO_STATUSES above
  if (s !== "clipped") return inS === null && outS === null ? { status: s, inS: null, outS: null, runMs } : null;
  if (typeof inS !== "number" || typeof outS !== "number" || !Number.isFinite(inS) || !Number.isFinite(outS)) return null;
  const a = roundTenth(inS);
  const b = roundTenth(outS);
  if (a < 0 || a >= b) return null;
  if (durationS !== null && (!Number.isFinite(durationS) || Math.round(b * 10) > Math.round(durationS * 10))) return null;
  return { status: s, inS: a, outS: b, runMs };
}

/** setClipAuto's reply: the stored values, or why nothing was written. */
export type SetClipAutoResult =
  | ({ readonly ok: true; readonly dev: boolean } & StoredAuto)
  | { readonly ok: false; readonly reason: "invalid" | "range" | "not_found" | "not_allowed" | "failed" };
