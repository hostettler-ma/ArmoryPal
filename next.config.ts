import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

// Service worker (PWA). Built from src/app/sw.ts into public/sw.js on `next build`;
// disabled in dev so it never serves stale code while developing.
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  // Pages are user-specific and live-updating: never cache them on navigation.
  cacheOnNavigation: false,
  additionalPrecacheEntries: [{ url: "/~offline", revision: "1" }],
});

// Baseline security headers on every response (checked by e2e/security).
// No Content-Security-Policy yet: Next's inline scripts and Supabase's
// websocket need a nonce-based policy, which is a bigger change.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" }, // no framing → no clickjacking
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSerwist(nextConfig);
