import type { NextConfig } from "next";

/** Read-only, single-user page: no framing, no sniffing, no referrer, no indexing. */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
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
