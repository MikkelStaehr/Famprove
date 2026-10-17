import type { NextConfig } from "next";

/**
 * Single-user page: no framing, no sniffing, no referrer, no indexing. Before video (user,
 * 2026-10-17, slice video-security; security's review): the camera for this origin only and no
 * microphone, location or screen capture; the browser connects, starts workers (blob: for the
 * recorder) and embeds objects only from this origin. No script-src: no third-party script loads
 * (fonts are self-hosted by next/font) and Next's own bootstrap is inline.
 */
export const CONTENT_SECURITY_POLICY =
  "frame-ancestors 'none'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'";
export const PERMISSIONS_POLICY = "camera=(self), microphone=(), geolocation=(), display-capture=()";

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false, // no dev badge over the page (it covered content in screenshots)
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // The tab shell (docs/decisions/tab-shell.md §2): Træning is /train; the home-screen bookmark on /
  // keeps working through a temporary redirect (308 would be cached for good).
  async redirects() {
    return [{ source: "/", destination: "/train", permanent: false }];
  },
};

export default nextConfig;
