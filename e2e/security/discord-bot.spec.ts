import { expect, test, uid } from "../support/fixtures";
import { publicApiSurface } from "../support/api-surface";
import { E2E_STORE_ID, localEnv } from "../support/env";
import { linkDiscordIdentity } from "../support/identities";
import { admin } from "../support/supabase";

/**
 * ArmoryBot's database surface (*_armorybot.sql, *_user_id_variants.sql) is for
 * the Edge Functions only, which hold the secret key. A signed-in player
 * calling it directly, with their own session, must be refused: otherwise
 * they could act as any Discord user (bot_attend takes a Discord ID) or link
 * servers to stores they don't run.
 */

// Internal helpers that take a user ID or bypass a sign-in check.
const INTERNAL = new Set([
  "user_for_discord",
  "discord_id_for_user",
  "is_user_banned",
  "display_name_of",
  "can_user_manage_store",
  "assert_event_open_for",
  "release_pledges",
  "attend_event_as",
  "leave_event_as",
  "ensure_current_events",
  "queue_discord_sync",
  "queue_discord_delete",
  "discord_link_for",
  "discord_post_at",
  "prune_discord_queues",
  "claim_discord_spots",
]);

const BOT_TABLES = ["discord_guild_stores", "discord_event_posts", "discord_outbox", "discord_dm_queue"];

test("signed-in players can't call any bot_* or internal user-ID function", async ({ newPlayer }) => {
  const mallory = await newPlayer({ name: `Mallory ${uid()}` });
  const { url, publishableKey } = localEnv();
  const { data: session } = await mallory.db.auth.getSession();
  const headers = {
    apikey: publishableKey,
    Authorization: `Bearer ${session.session!.access_token}`,
    "Content-Type": "application/json",
  };

  const surface = publicApiSurface();
  const targets = surface.functions.filter((fn) => fn.name.startsWith("bot_") || INTERNAL.has(fn.name));
  // Every bot RPC from docs/armorybot.md §4.6 is in the generated types (so it's actually checked).
  expect(targets.map((f) => f.name)).toEqual(expect.arrayContaining(["bot_attend", "bot_leave", "bot_guest_leave", "bot_link_store", "bot_claim_outbox", "claim_discord_spots"]));

  const open: string[] = [];
  for (const fn of targets) {
    const res = await fetch(`${url}/rest/v1/rpc/${fn.name}`, { method: "POST", headers, body: JSON.stringify(fn.args) });
    if (res.status !== 401 && res.status !== 403) open.push(`rpc/${fn.name} → ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
  expect(open, "bot functions a signed-in player can call").toEqual([]);
});

test("signed-in players can't read or write the bot tables, and see only their own DM status", async ({ newPlayer }) => {
  const mallory = await newPlayer({ name: `Mallory ${uid()}` });
  const victim = await newPlayer({ name: `Victim ${uid()}` });

  for (const table of BOT_TABLES) {
    const read = await mallory.db.from(table as "discord_outbox").select("*").limit(1);
    expect(read.error?.code, `read ${table}`).toBe("42501");
  }
  // Forging a link would make the bot post a store's events (and buttons) in an attacker's server.
  const forged = await mallory.db
    .from("discord_guild_stores")
    .insert({ guild_id: "1", store_id: "00000000-0000-4000-a000-000000000000", channel_id: "1" });
  expect(forged.error?.code).toBe("42501");
  const forgedDm = await mallory.db
    .from("discord_dm_queue")
    .insert({ user_id: victim.id, discord_id: "1", event_id: "00000000-0000-4000-a000-000000000000", kind: "new_requests", payload: {}, send_after: new Date().toISOString() });
  expect(forgedDm.error?.code).toBe("42501");

  await admin()
    .from("discord_dm_status")
    .upsert({ user_id: victim.id, undeliverable_at: new Date().toISOString(), error_code: 50007 });
  expect((await mallory.db.from("discord_dm_status").select("user_id")).data).toEqual([]);
  expect((await victim.db.from("discord_dm_status").select("user_id")).data).toEqual([{ user_id: victim.id }]);
  // Read-only even for the owner: clearing it would only be done by the worker.
  await victim.db.from("discord_dm_status").delete().eq("user_id", victim.id);
  expect((await admin().from("discord_dm_status").select("user_id").eq("user_id", victim.id)).data).toHaveLength(1);
});

test("Discord guests: players see names only, and can't add, rename or remove guests", async ({ newPlayer }) => {
  const mallory = await newPlayer({ name: `Mallory ${uid()}` });
  const { data: events } = await mallory.db.rpc("current_events_for_stores", { p_store_ids: [E2E_STORE_ID] });
  const eventId = events![0].id;
  const discordId = `1${Date.now()}`;
  await admin().rpc("bot_attend", { p_discord_id: discordId, p_event_id: eventId, p_display_name: "Guest" });
  try {
    // Discord IDs stay server-side (column grants).
    expect((await mallory.db.from("discord_attendees").select("discord_id").limit(1)).error?.code).toBe("42501");
    expect((await mallory.db.from("discord_attendees").select("*").limit(1)).error?.code).toBe("42501");
    const forged = await mallory.db
      .from("discord_attendees")
      .insert({ event_id: eventId, discord_id: "1", display_name: "Fake" });
    expect(forged.error?.code).toBe("42501");
    await mallory.db.from("discord_attendees").update({ display_name: "Pwned" }).eq("event_id", eventId);
    await mallory.db.from("discord_attendees").delete().eq("event_id", eventId);
    const { data } = await admin().from("discord_attendees").select("display_name").eq("discord_id", discordId);
    expect(data).toEqual([{ display_name: "Guest" }]);
  } finally {
    await admin().rpc("bot_guest_leave", { p_discord_id: discordId, p_event_id: eventId });
  }
});

test("players can't opt someone else into Discord DMs", async ({ newPlayer }) => {
  const mallory = await newPlayer({ name: `Mallory ${uid()}` });
  const victim = await newPlayer({ name: `Victim ${uid()}` });
  await mallory.db
    .from("notification_preferences")
    .upsert({ user_id: victim.id, kind: "new_requests", channel: "discord", enabled: true }, { onConflict: "user_id,kind,channel" });
  const { data } = await admin().from("notification_preferences").select("*").eq("user_id", victim.id);
  expect(data).toEqual([]);
});

test("a Discord account can't be connected to two ArmoryPal accounts", async ({ newPlayer }) => {
  const alice = await newPlayer({ name: `Alice ${uid()}` });
  const mallory = await newPlayer({ name: `Mallory ${uid()}` });
  const discordId = await linkDiscordIdentity(alice.id);
  // Even a write that bypasses Supabase Auth's own check hits the unique (provider_id, provider) constraint.
  await expect(linkDiscordIdentity(mallory.id, discordId)).rejects.toThrow(/identities_provider_id_provider_unique/);
  const { data } = await admin().auth.admin.getUserById(mallory.id);
  expect(data.user?.identities?.map((i) => i.provider)).toEqual(["email"]);
  // And ArmoryBot resolves that Discord account to Alice only.
  expect((await admin().rpc("user_for_discord", { p_discord_id: discordId })).data).toBe(alice.id);
});

test.describe("the Discord interactions endpoint", () => {
  const endpoint = () => `${localEnv().url}/functions/v1/discord-interactions`;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(endpoint(), { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  test("is deployed (so the 401s below come from the signature check)", async () => {
    expect((await fetch(endpoint())).status).toBe(405);
  });

  test("rejects unsigned and badly signed requests without acting on them", async ({ newPlayer }) => {
    // A real, linked player, so a request that slipped through would actually attend.
    const victim = await newPlayer({ name: `Victim ${uid()}` });
    const discordId = await linkDiscordIdentity(victim.id);
    const { data: events } = await victim.db.rpc("current_events_for_stores", { p_store_ids: [E2E_STORE_ID] });
    const eventId = events![0].id;
    const going = {
      id: "1",
      application_id: "1",
      token: "t",
      type: 3,
      guild_id: "1",
      member: { user: { id: discordId } },
      data: { custom_id: `ap:going:${eventId}` },
    };
    const now = String(Math.floor(Date.now() / 1000));
    const attempts: [string, Record<string, string>][] = [
      ["no signature", {}],
      ["garbage signature", { "X-Signature-Ed25519": "ab".repeat(64), "X-Signature-Timestamp": now }],
      ["malformed signature", { "X-Signature-Ed25519": "not-hex", "X-Signature-Timestamp": now }],
      ["signature without timestamp", { "X-Signature-Ed25519": "ab".repeat(64) }],
    ];
    for (const [what, headers] of attempts) {
      expect((await post(going, headers)).status, what).toBe(401);
      expect((await post({ type: 1 }, headers)).status, `PING, ${what}`).toBe(401);
    }
    const { data } = await admin().from("attendances").select("user_id").eq("event_id", eventId).eq("user_id", victim.id);
    expect(data).toEqual([]);
  });
});

test("the Discord worker endpoint only runs for the shared secret", async () => {
  const endpoint = `${localEnv().url}/functions/v1/discord-worker`;
  // Deployed (405 for GET), so the 401s below come from the secret check.
  expect((await fetch(endpoint)).status).toBe(405);
  for (const auth of [undefined, "Bearer ", "Bearer wrong-wrong-wrong-wrong-wrong-wrong", `Bearer ${localEnv().secretKey}`]) {
    const res = await fetch(endpoint, { method: "POST", headers: auth ? { Authorization: auth } : {} });
    expect(res.status, `Authorization: ${auth?.slice(0, 12)}…`).toBe(401);
  }
});
