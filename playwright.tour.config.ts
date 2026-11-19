import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Takes the example screenshots on the /about page (public/tour/*.png) from a production build
// against local Supabase, with real card data (run scripts/import-cards.mts first).
// Not part of the test suite: run it by hand with `npm run tour:screenshots` after UI changes.
export default defineConfig({
  ...base,
  retries: 0,
  projects: [
    {
      name: "tour",
      testDir: "e2e/tour",
      use: {
        viewport: { width: 390, height: 700 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        colorScheme: "light",
        reducedMotion: "reduce",
      },
    },
  ],
});
