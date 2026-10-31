import { config } from "dotenv";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

// End-to-end tests (Playwright). Two targets, picked with E2E_TARGET:
//
// - "local" (default): local Supabase + a production build of the app.
//   Every test creates its own throwaway users and writes freely, so this
//   must NEVER point at production; e2e/support/env.ts refuses to run unless
//   the Supabase URL is local.
// - "prod": read-only smoke checks against the live site. No sign-ins, no
//   writes. Needs PROD_BASE_URL (and PROD_SUPABASE_URL +
//   PROD_SUPABASE_PUBLISHABLE_KEY for the database lockdown checks).
//
// See e2e/README.md.

config({ path: ".env.local", quiet: true });

const CI = !!process.env.CI;
const target = process.env.E2E_TARGET === "prod" ? "prod" : "local";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

const shared: PlaywrightTestConfig = {
  testDir: "e2e",
  // Realtime and shared-event flows are easier to reason about one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
};

const local: PlaywrightTestConfig = {
  ...shared,
  use: { ...shared.use, baseURL: BASE_URL },
  globalSetup: "./e2e/support/global-setup.ts",
  projects: [
    // Phone first: the app is designed for ~375px wide.
    { name: "mobile", testDir: "e2e/functional", use: { ...devices["Pixel 7"] } },
    { name: "desktop", testDir: "e2e/functional", use: { ...devices["Desktop Chrome"] } },
    { name: "security", testDir: "e2e/security", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        // A production build, so the service worker and real caching rules are what's tested.
        command: CI ? "npm start" : "npm run build && npm start",
        url: BASE_URL,
        reuseExistingServer: !CI,
        timeout: 180_000,
        stdout: "pipe",
        stderr: "pipe",
      },
};

const prod: PlaywrightTestConfig = {
  ...shared,
  retries: 2, // the live site sits behind the network; don't page on one blip
  use: { ...shared.use, baseURL: process.env.PROD_BASE_URL },
  projects: [{ name: "prod", testDir: "e2e/prod", use: { ...devices["Desktop Chrome"] } }],
};

export default defineConfig(target === "prod" ? prod : local);
