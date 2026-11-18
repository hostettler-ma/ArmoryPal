// ArmoryBot's worker: posts scheduled events and keeps posts in sync.
// Called by pg_cron every minute and by pg_net right after outbox rows are
// queued (kick_discord_worker(); URL and secret in Vault). Deployed with
// verify_jwt = false: the shared secret below is the auth.

import { createRpc } from "../_shared/db.ts";
import { createDiscordClient } from "../_shared/discord-rest.ts";
import { runWorker } from "../_shared/worker.ts";

/** Stop starting new work after this long (hosted wall-clock limit is 150 s; cron runs every minute). */
const RUN_FOR_MS = 45_000;

function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // fall through to the legacy variable
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

/** Constant-time comparison, so the secret can't be guessed byte by byte from timings. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const expected = Deno.env.get("DISCORD_WORKER_SECRET") ?? "";
  const given = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  // Fail closed: no configured secret means nobody gets in.
  if (expected.length < 32 || !sameSecret(given, expected)) return new Response("Unauthorized", { status: 401 });

  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  if (!token) return new Response("DISCORD_BOT_TOKEN is not set", { status: 500 });

  const report = await runWorker({
    rpc: createRpc({ url: Deno.env.get("SUPABASE_URL") ?? "", secretKey: secretKey() }),
    discord: createDiscordClient({ token }),
    appUrl: (Deno.env.get("ARMORYPAL_URL") ?? "https://armorypal.vercel.app").replace(/\/+$/, ""),
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    deadline: Date.now() + RUN_FOR_MS,
  });
  console.log("discord-worker", JSON.stringify(report));
  return new Response(JSON.stringify(report), { headers: { "Content-Type": "application/json" } });
});
