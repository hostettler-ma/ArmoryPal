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

const nextConfig: NextConfig = {};

export default withSerwist(nextConfig);
