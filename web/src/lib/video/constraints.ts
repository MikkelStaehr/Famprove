/**
 * getUserMedia constraints for a set's clip (slice video-record): the back camera, 720p at 30 fps,
 * no audio (nothing of the room is recorded). Ideal values, so a phone that can't do exactly this
 * still records.
 */
export const CAMERA_CONSTRAINTS = {
  video: { facingMode: "environment", width: 1280, height: 720, frameRate: 30 },
  audio: false,
} as const satisfies MediaStreamConstraints;
