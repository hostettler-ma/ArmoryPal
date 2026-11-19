// ArmoryBot's interactions endpoint (Discord → "Interactions Endpoint URL").
// Deployed with verify_jwt = false: Discord's Ed25519 signature is the auth.
// Unsigned or badly signed requests get 401 before anything else happens.
//
// Discord needs an answer within 3 seconds. Handlers normally finish well
// inside that; if one doesn't, we answer with a deferred "thinking…"
// response and finish in the background (EdgeRuntime.waitUntil), editing the
// reply when done.

import { createRpc } from "../_shared/db.ts";
import { editOriginalResponse } from "../_shared/discord-api.ts";
import type { Interaction, InteractionResponse } from "../_shared/discord-types.ts";
import { deferredResponseFor, followUpBody, handleInteraction } from "../_shared/interactions.ts";
import { verifyDiscordRequest } from "../_shared/verify.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

/** Answer directly if the handler is done by then; otherwise defer. */
const DEFER_AFTER_MS = 2200;

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

const rpc = createRpc({ url: Deno.env.get("SUPABASE_URL") ?? "", secretKey: secretKey() });
const appUrl = (Deno.env.get("ARMORYPAL_URL") ?? "https://armorypal.vercel.app").replace(/\/+$/, "");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const body = await req.text();
  const verified = await verifyDiscordRequest({
    publicKeyHex: Deno.env.get("DISCORD_PUBLIC_KEY"),
    signatureHex: req.headers.get("X-Signature-Ed25519"),
    timestamp: req.headers.get("X-Signature-Timestamp"),
    body,
  });
  if (!verified) return new Response("Invalid request signature", { status: 401 });

  let interaction: Interaction;
  try {
    interaction = JSON.parse(body) as Interaction;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const work = handleInteraction(interaction, { rpc, appUrl });
  const deferred = deferredResponseFor(interaction);
  if (!deferred) return json(await work);

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), DEFER_AFTER_MS));
  const first = await Promise.race<InteractionResponse | null>([work, timeout]);
  if (first) return json(first);

  // Too slow: tell Discord we're on it, and edit the reply when the work is done.
  const finish = work.then((res) =>
    editOriginalResponse(Deno.env.get("DISCORD_APP_ID") ?? interaction.application_id, interaction.token, followUpBody(res)),
  );
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(finish);
  return json(deferred);
});
