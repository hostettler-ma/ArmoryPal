import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

/** Local Supabase settings. Throws unless they point at a local stack. */
export function localEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) {
    throw new Error(
      "E2E tests need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (see .env.example).",
    );
  }
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    // These tests create users, write requests and run attack payloads.
    throw new Error(`E2E tests only run against local Supabase; got ${url}`);
  }
  return {
    url,
    publishableKey,
    secretKey,
    /** Mailpit (catches magic-link emails); `npx supabase status` shows it. */
    mailpitUrl: process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324",
  };
}

/** The fixed id of the store global-setup creates for the tests. */
export const E2E_STORE_ID = "00000000-0000-4000-a000-0000000e2e01";
export const E2E_STORE_NAME = "E2E Test Armory";

/** Test cards (names chosen so they never collide with the real catalog). */
export const CARDS = {
  snatch: "Zeetest Snatch", // red, yellow, blue
  sledge: "Zeetest Sledge", // no pitch (weapon)
} as const;
