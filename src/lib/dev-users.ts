/**
 * Local test players for trying features without Discord. `scripts/seed-dev.mts`
 * creates them, and the login page offers one-tap sign-in as each one, but only
 * in `next dev` against a local Supabase (see devLoginEnabled).
 */
export const DEV_USERS = [
  { email: "alice@dev.local", name: "Alice (dev)" },
  { email: "bob@dev.local", name: "Bob (dev)" },
  { email: "carol@dev.local", name: "Carol (dev)" },
] as const;

/** Shared password. Safe to commit: these accounts only exist in local Supabase. */
export const DEV_PASSWORD = "armorypal-dev";

export function isLocalSupabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
}

/** True only for `next dev` pointed at a local Supabase. Never true on Vercel. */
export function devLoginEnabled(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): boolean {
  return nodeEnv === "development" && isLocalSupabase(supabaseUrl);
}

export function isDevUser(email: string): boolean {
  return DEV_USERS.some((u) => u.email === email);
}
