import assert from "node:assert/strict";
import { test } from "node:test";

import { CONTENT_SECURITY_POLICY, PERMISSIONS_POLICY } from "../next.config.ts";

// Slice video-security (user, 2026-10-17): the headers security asked for before any recording.
test("the camera is this origin's only; no microphone, location or screen capture", () => {
  const policy = Object.fromEntries(PERMISSIONS_POLICY.split(",").map((p) => p.trim().split("=")));
  assert.deepEqual(policy, { camera: "(self)", microphone: "()", geolocation: "()", "display-capture": "()" });
});

test("the CSP keeps framing off and limits connections, workers, objects and base to this origin", () => {
  const directives = Object.fromEntries(
    CONTENT_SECURITY_POLICY.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values.join(" ")];
    }),
  );
  assert.deepEqual(directives, {
    "frame-ancestors": "'none'",
    "connect-src": "'self'",
    "worker-src": "'self' blob:",
    "object-src": "'none'",
    "base-uri": "'none'",
  });
});
