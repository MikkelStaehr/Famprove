/**
 * The recorder's container and codec (slice video-record): MP4/H.264 first (plays and shares
 * everywhere), then WebM VP9, then VP8; none = no recording. Pure: the caller passes
 * MediaRecorder.isTypeSupported (undefined when MediaRecorder is missing).
 */

export type ClipExt = "mp4" | "webm";

export type RecorderType = {
  readonly mimeType: string; // for new MediaRecorder(stream, { mimeType })
  readonly ext: ClipExt; // the OPFS file's and the shared file's extension
  readonly fileType: string; // the File's type for navigator.share (no codecs)
};

export const RECORDER_TYPES: readonly RecorderType[] = [
  { mimeType: "video/mp4;codecs=avc1", ext: "mp4", fileType: "video/mp4" },
  { mimeType: "video/webm;codecs=vp9", ext: "webm", fileType: "video/webm" },
  { mimeType: "video/webm;codecs=vp8", ext: "webm", fileType: "video/webm" },
];

export function pickRecorderType(isTypeSupported: ((type: string) => boolean) | undefined): RecorderType | null {
  if (isTypeSupported === undefined) return null;
  return RECORDER_TYPES.find((t) => isTypeSupported(t.mimeType)) ?? null;
}

/** The file type for a stored clip's extension. */
export function fileTypeOf(ext: ClipExt): string {
  return ext === "mp4" ? "video/mp4" : "video/webm";
}

/**
 * A keyframe every second (user, 2026-10-20, slice clip-cut): a cut without re-encoding starts at a
 * keyframe, so with this it starts at most 1 s early. Chrome's MediaRecorder option; a browser
 * without it ignores it silently, so the spacing is measured (Kameratest), never assumed.
 */
export const KEYFRAME_INTERVAL_MS = 1000;

/** MediaRecorder's options: TypeScript's DOM types don't have the keyframe option yet. */
export type RecorderOptions = MediaRecorderOptions & { readonly videoKeyFrameIntervalDuration?: number };

export function recorderOptions(type: RecorderType): RecorderOptions {
  return { mimeType: type.mimeType, videoKeyFrameIntervalDuration: KEYFRAME_INTERVAL_MS };
}
