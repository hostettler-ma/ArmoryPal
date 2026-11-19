import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, closeDb, pauseDiscordWorker, resumeDiscordWorker, createTestUser, db, deleteTestUsers, linkDiscord, snowflake, type TestUser } from "./helpers";

// ArmoryBot groundwork (*_user_id_variants.sql, *_armorybot.sql): bot RPCs
// apply the app's rules, link permissions, outbox triggers, the DM queue.

const CARDS = [
  { id: "test-bot-red", name: "Bot Test Strike", pitch: 1, color: "Red", types: ["Generic"] },
  { id: "test-bot-blue", name: "Bot Test Strike", pitch: 3, color: "Blue", types: ["Generic"] },
];

let owner: TestUser; // owns the store, Discord linked
let player: TestUser; // Discord linked
let helper: TestUser; // Discord linked, pledges
let follower: TestUser; // saved the store, Discord linked
let unlinked: TestUser; // no Discord
let adminUser: TestUser; // admin, Discord linked
let ownerDiscord: string;
let playerDiscord: string;
let helperDiscord: string;
let followerDiscord: string;
let adminDiscord: string;
let storeId: string;
let otherStoreId: string;
const guild = snowflake();
const channel = snowflake();

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error || res.data === null) throw new Error(`${what}: ${res.error?.message ?? "no data"}`);
  return res.data;
}

function ok(res: { error: { message: string } | null }, what: string) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
}

const errorOf = async (p: PromiseLike<{ error: { message: string } | null }>) => (await p).error?.message;

/** A one-off event two days out, created by the owner. */
async function oneOff(label = "Bot Armory") {
  return must(
    await owner.client.rpc("owner_create_event", {
      p_store_id: storeId,
      p_label: label,
      p_date: plusDays(today(), 2),
      p_start_time: "18:00",
    }),
    "create event",
  );
}

/** Gives the event a live Discord post in our test server, so triggers queue work. */
async function post(eventId: string) {
  ok(await admin
      .from("discord_event_posts")
      .insert({ guild_id: guild, event_id: eventId, channel_id: channel, message_id: snowflake(), posted_at: new Date().toISOString() })
      , "post");
}

const pending = async (eventId: string) =>
  must(
    await admin
      .from("discord_outbox")
      .select("id, kind, payload")
      .eq("event_id", eventId)
      .is("processed_at", null)
      .is("claimed_until", null)
      .order("id"),
    "outbox",
  );

const dmsFor = async (userId: string, eventId: string) =>
  must(await admin.from("discord_dm_queue").select("kind, payload, discord_id").eq("user_id", userId).eq("event_id", eventId), "dms");

beforeAll(async () => {
  await pauseDiscordWorker();
  await admin.from("cards").upsert(CARDS);
  [owner, player, helper, follower, unlinked, adminUser] = await Promise.all([
    createTestUser({ name: "Bot Owner" }),
    createTestUser({ name: "Bot Player" }),
    createTestUser({ name: "Bot Helper" }),
    createTestUser({ name: "Bot Follower" }),
    createTestUser({ name: "Bot Unlinked" }),
    createTestUser({ name: "Bot Admin", isAdmin: true }),
  ]);
  [ownerDiscord, playerDiscord, helperDiscord, followerDiscord, adminDiscord] = await Promise.all(
    [owner, player, helper, follower, adminUser].map((u) => linkDiscord(u.id)),
  );
  const { data: stores } = await admin
    .from("stores")
    .insert([
      { name: "Bot Test Store", city: "Botville", region: "BT", country: "Testland", timezone: "UTC" },
      { name: "Bot Other Store", city: "Botville", country: "Testland", timezone: "UTC" },
    ])
    .select("id, name")
    .order("name", { ascending: false });
  [storeId, otherStoreId] = stores!.map((s) => s.id);
  await admin.from("store_owners").insert({ store_id: storeId, user_id: owner.id });
  await admin.from("user_stores").insert({ store_id: storeId, user_id: follower.id });
});

afterAll(async () => {
  await admin.from("discord_guild_stores").delete().eq("guild_id", guild);
  await admin.from("discord_event_posts").delete().eq("guild_id", guild);
  const { data: events } = await admin.from("events").select("id").in("store_id", [storeId, otherStoreId]);
  const ids = (events ?? []).map((e) => e.id);
  await admin.from("discord_outbox").delete().in("event_id", ids);
  await admin.from("events").delete().in("store_id", [storeId, otherStoreId]);
  await admin.from("stores").delete().in("id", [storeId, otherStoreId]);
  await deleteTestUsers();
  await resumeDiscordWorker();
  await closeDb();
});

describe("identity", () => {
  it("a Discord account can belong to only one ArmoryPal account", async () => {
    const [row] = await db()`
      select pg_get_constraintdef(c.oid) as def from pg_constraint c
      where c.conrelid = 'auth.identities'::regclass and c.contype = 'u'`;
    expect(row.def).toBe("UNIQUE (provider_id, provider)");
    await expect(linkDiscord(unlinked.id, playerDiscord)).rejects.toThrow(/identities_provider_id_provider_unique/);
  });

  it("maps Discord IDs to users and back", async () => {
    expect(must(await admin.rpc("user_for_discord", { p_discord_id: playerDiscord }), "lookup")).toBe(player.id);
    expect(must(await admin.rpc("discord_id_for_user", { p_user_id: player.id }), "lookup")).toBe(playerDiscord);
    expect((await admin.rpc("user_for_discord", { p_discord_id: snowflake() })).data).toBeNull();
  });
});

describe("access", () => {
  it("signed-in players can't call bot or internal functions", async () => {
    const eventId = await oneOff();
    const calls = [
      player.client.rpc("bot_attend", { p_discord_id: playerDiscord, p_event_id: eventId }),
      player.client.rpc("bot_leave", { p_discord_id: playerDiscord, p_event_id: eventId, p_cancel_requests: true }),
      player.client.rpc("bot_link_store", { p_discord_id: ownerDiscord, p_guild_id: guild, p_channel_id: channel, p_store_id: storeId }),
      player.client.rpc("bot_render_event", { p_event_id: eventId }),
      player.client.rpc("bot_claim_outbox", { p_limit: 5 }),
      player.client.rpc("bot_search_stores", { p_query: "bot" }),
      player.client.rpc("user_for_discord", { p_discord_id: playerDiscord }),
      player.client.rpc("attend_event_as", { p_event_id: eventId, p_user_id: helper.id }),
      player.client.rpc("leave_event_as", {
        p_event_id: eventId,
        p_user_id: helper.id,
        p_cancel_requests: true,
        p_reason: "left_event",
        p_notify_owners: false,
      }),
      player.client.rpc("ensure_current_events", { p_store_ids: [storeId] }),
    ];
    for (const res of await Promise.all(calls)) expect(res.error?.code).toBe("42501");
    expect((await admin.from("attendances").select("user_id").eq("event_id", eventId)).data).toEqual([]);
  });

  it("signed-in players can't read or write the bot tables, except their own DM status", async () => {
    await admin.from("discord_dm_status").upsert([
      { user_id: player.id, undeliverable_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), error_code: 50007 },
      { user_id: helper.id, undeliverable_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), error_code: 50278 },
    ]);
    for (const table of ["discord_guild_stores", "discord_event_posts", "discord_outbox", "discord_dm_queue"] as const) {
      expect((await player.client.from(table).select("*")).error?.code, table).toBe("42501");
    }
    expect(must(await player.client.from("discord_dm_status").select("user_id, error_code"), "status")).toEqual([
      { user_id: player.id, error_code: 50007 },
    ]);
    await player.client.from("discord_dm_status").delete().eq("user_id", player.id);
    await player.client
      .from("discord_guild_stores")
      .insert({ guild_id: guild, store_id: storeId, channel_id: channel, days_before: 6 });
    expect((await admin.from("discord_dm_status").select("user_id").eq("user_id", player.id)).data).toHaveLength(1);
    expect((await admin.from("discord_guild_stores").select("*").eq("guild_id", guild)).data).toEqual([]);
    await admin.from("discord_dm_status").delete().in("user_id", [player.id, helper.id]);
  });
});

describe("attend and leave from Discord", () => {
  it("needs a linked, set-up, unbanned account", async () => {
    const eventId = await oneOff();
    expect(await errorOf(admin.rpc("bot_attend", { p_discord_id: snowflake(), p_event_id: eventId }))).toBe("discord_not_linked");

    const blank = await createTestUser({ name: "Bot Blank" });
    await admin.from("profiles").update({ display_name: null }).eq("id", blank.id);
    const blankDiscord = await linkDiscord(blank.id);
    expect(await errorOf(admin.rpc("bot_attend", { p_discord_id: blankDiscord, p_event_id: eventId }))).toBe("profile_incomplete");

    const banned = await createTestUser({ name: "Bot Banned" });
    const bannedDiscord = await linkDiscord(banned.id);
    ok(await adminUser.client.rpc("admin_ban", { p_user_id: banned.id, p_reason: "test" }), "ban");
    expect(await errorOf(admin.rpc("bot_attend", { p_discord_id: bannedDiscord, p_event_id: eventId }))).toBe("banned");
  });

  it("follows the app's event rules: open, not cancelled, not deleted", async () => {
    const ended = (
      await admin
        .from("events")
        .insert({
          store_id: storeId,
          event_date: plusDays(today(), -2),
          starts_at: `${plusDays(today(), -2)}T18:00:00Z`,
          ends_at: `${plusDays(today(), -1)}T00:00:00Z`,
          label: "Old Armory",
        })
        .select("id")
        .single()
    ).data!.id;
    expect(await errorOf(admin.rpc("bot_attend", { p_discord_id: playerDiscord, p_event_id: ended }))).toBe("event_ended");

    const cancelled = await oneOff("Cancelled Armory");
    ok(await owner.client.rpc("owner_cancel_event", { p_event_id: cancelled }), "cancel");
    expect(await errorOf(admin.rpc("bot_attend", { p_discord_id: playerDiscord, p_event_id: cancelled }))).toBe("event_cancelled");
    expect(
      await errorOf(admin.rpc("bot_leave", { p_discord_id: playerDiscord, p_event_id: cancelled, p_cancel_requests: false })),
    ).toBe("event_cancelled");

    const deleted = await oneOff("Deleted Armory");
    ok(await owner.client.rpc("owner_delete_event", { p_event_id: deleted }), "delete");
    expect(await errorOf(admin.rpc("bot_attend", { p_discord_id: playerDiscord, p_event_id: deleted }))).toBe("event_not_found");
  });

  it("attends, then leaves keeping requests: pledges released, requests stay, owners told", async () => {
    const eventId = await oneOff();
    ok(await admin.rpc("bot_attend", { p_discord_id: playerDiscord, p_event_id: eventId }), "attend");
    ok(await admin.rpc("bot_attend", { p_discord_id: playerDiscord, p_event_id: eventId }), "attend twice");
    await helper.client.rpc("attend_event", { p_event_id: eventId });
    // Player requests a card; helper requests one that player pledges on.
    must(
      await player.client.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "test-bot-red", quantity: 2 }] }),
      "player add",
    );
    must(
      await helper.client.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "test-bot-blue", quantity: 1 }] }),
      "helper add",
    );
    const { data: helperReq } = await admin.from("requests").select("id").eq("event_id", eventId).eq("requester_id", helper.id).single();
    expect((await player.client.rpc("pledge", { p_request_id: helperReq!.id, p_quantity: 1 })).error).toBeNull();

    ok(await admin.rpc("bot_leave", { p_discord_id: playerDiscord, p_event_id: eventId, p_cancel_requests: false }), "leave");

    expect((await admin.from("attendances").select("user_id").eq("event_id", eventId)).data).toEqual([{ user_id: helper.id }]);
    expect((await admin.from("pledges").select("id").eq("event_id", eventId)).data).toEqual([]);
    const { data: kept } = await admin.from("requests").select("status").eq("event_id", eventId).eq("requester_id", player.id);
    expect(kept).toEqual([{ status: "active" }]);
    const { data: released } = await helper.client
      .from("notifications")
      .select("payload")
      .eq("event_id", eventId)
      .eq("kind", "pledge_released");
    expect(released).toEqual([{ payload: expect.objectContaining({ actor: "Bot Player", reason: "left_event" }) }]);
    const { data: left } = await owner.client.from("notifications").select("payload").eq("event_id", eventId).eq("kind", "attendee_left");
    expect(left).toEqual([{ payload: expect.objectContaining({ actor: "Bot Player" }) }]);
  });

  it("leaving and cancelling requests tells their pledgers", async () => {
    const eventId = await oneOff();
    await admin.rpc("bot_attend", { p_discord_id: playerDiscord, p_event_id: eventId });
    await helper.client.rpc("attend_event", { p_event_id: eventId });
    must(
      await player.client.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "test-bot-red", quantity: 2 }] }),
      "add",
    );
    const { data: req } = await admin.from("requests").select("id").eq("event_id", eventId).single();
    expect((await helper.client.rpc("pledge", { p_request_id: req!.id, p_quantity: 2 })).error).toBeNull();

    ok(await admin.rpc("bot_leave", { p_discord_id: playerDiscord, p_event_id: eventId, p_cancel_requests: true }), "leave");

    expect((await admin.from("requests").select("status").eq("id", req!.id).single()).data).toEqual({ status: "cancelled" });
    expect((await admin.from("pledges").select("id").eq("request_id", req!.id)).data).toEqual([]);
    const { data: told } = await helper.client
      .from("notifications")
      .select("payload")
      .eq("event_id", eventId)
      .eq("kind", "request_cancelled");
    expect(told).toEqual([{ payload: expect.objectContaining({ actor: "Bot Player", reason: "left_event" }) }]);
  });
});

describe("linking a server", () => {
  it("without Manage Server, only store managers with Discord linked can link a store", async () => {
    const link = (discordId: string, store = storeId) =>
      admin.rpc("bot_link_store", { p_discord_id: discordId, p_guild_id: guild, p_channel_id: channel, p_store_id: store });

    expect(await errorOf(link(playerDiscord))).toBe("not_store_owner");
    expect(await errorOf(link(snowflake()))).toBe("discord_not_linked");
    expect(await errorOf(link(ownerDiscord, "00000000-0000-4000-a000-000000000000"))).toBe("store_not_found");

    const linked = must(await link(ownerDiscord), "owner links");
    expect(linked).toMatchObject({ guild_id: guild, store_id: storeId, channel_id: channel, days_before: 2, linked_by: owner.id });
    // Admins can link any store; the owner can't link a store they don't run.
    expect(await errorOf(link(ownerDiscord, otherStoreId))).toBe("not_store_owner");
    must(await link(adminDiscord, otherStoreId), "admin links");
  });

  it("anyone with Manage Server can link and configure a store, even without an ArmoryPal account", async () => {
    const otherGuild = snowflake();
    const manager = snowflake(); // runs the Discord server, not on ArmoryPal
    const linked = must(
      await admin.rpc("bot_link_store", {
        p_discord_id: manager,
        p_guild_id: otherGuild,
        p_channel_id: channel,
        p_store_id: storeId,
        p_has_manage_guild: true,
      }),
      "manager links",
    );
    expect(linked).toMatchObject({ guild_id: otherGuild, store_id: storeId, linked_by: null });
    const updated = must(
      await admin.rpc("bot_update_settings", { p_discord_id: manager, p_guild_id: otherGuild, p_days_before: 4, p_has_manage_guild: true }),
      "manager settings",
    );
    expect(updated.days_before).toBe(4);
    expect(
      await errorOf(admin.rpc("bot_update_settings", { p_discord_id: manager, p_guild_id: otherGuild, p_days_before: 5 })),
    ).toBe("discord_not_linked");
    // Still refused: archived or unknown stores, and suspended accounts.
    expect(
      await errorOf(
        admin.rpc("bot_link_store", {
          p_discord_id: manager,
          p_guild_id: otherGuild,
          p_channel_id: channel,
          p_store_id: "00000000-0000-4000-a000-000000000000",
          p_has_manage_guild: true,
        }),
      ),
    ).toBe("store_not_found");
    const banned = await createTestUser({ name: "Bot Banned Manager" });
    const bannedDiscord = await linkDiscord(banned.id);
    await db()`insert into public.bans (user_id, reason) values (${banned.id}, 'test')`;
    expect(
      await errorOf(
        admin.rpc("bot_link_store", {
          p_discord_id: bannedDiscord,
          p_guild_id: otherGuild,
          p_channel_id: channel,
          p_store_id: storeId,
          p_has_manage_guild: true,
        }),
      ),
    ).toBe("banned");
    await db()`delete from public.discord_guild_stores where guild_id = ${otherGuild}`;
  });

  it("archived stores can't be linked", async () => {
    await admin.from("stores").update({ archived_at: new Date().toISOString() }).eq("id", otherStoreId);
    const res = await admin.rpc("bot_link_store", {
      p_discord_id: adminDiscord,
      p_guild_id: snowflake(),
      p_channel_id: channel,
      p_store_id: otherStoreId,
    });
    expect(res.error?.message).toBe("store_not_found");
    const found = must(await admin.rpc("bot_search_stores", { p_query: "Bot" }), "search");
    expect(found.map((s) => s.id)).toContain(storeId);
    expect(found.map((s) => s.id)).not.toContain(otherStoreId);
    await admin.from("stores").update({ archived_at: null }).eq("id", otherStoreId);
  });

  it("settings: manager only, 0–6 days, and a store when the server has several", async () => {
    const settings = (args: { p_discord_id: string; p_store_id?: string; p_days_before?: number; p_post_time?: string }) =>
      admin.rpc("bot_update_settings", { p_guild_id: guild, ...args });

    expect(await errorOf(settings({ p_discord_id: ownerDiscord, p_days_before: 3 }))).toBe("store_required");
    expect(await errorOf(settings({ p_discord_id: playerDiscord, p_store_id: storeId, p_days_before: 3 }))).toBe("not_store_owner");
    expect(await errorOf(settings({ p_discord_id: ownerDiscord, p_store_id: storeId, p_days_before: 7 }))).toBe("invalid_days_before");
    expect(await errorOf(settings({ p_discord_id: ownerDiscord, p_store_id: storeId, p_days_before: -1 }))).toBe("invalid_days_before");
    const updated = must(
      await settings({ p_discord_id: ownerDiscord, p_store_id: storeId, p_days_before: 6, p_post_time: "09:30" }),
      "update",
    );
    expect(updated).toMatchObject({ days_before: 6, post_time: "09:30:00", channel_id: channel });
  });

  it("status lists each link and its next post", async () => {
    await oneOff("Status Armory");
    const status = must(await admin.rpc("bot_status", { p_guild_id: guild }), "status") as {
      store_id: string;
      days_before: number;
      next_post: { event_id: string; post_at: string } | null;
    }[];
    const mine = status.find((s) => s.store_id === storeId)!;
    expect(mine.days_before).toBe(6);
    expect(mine.next_post).not.toBeNull();
    const { data: next } = await admin.from("events").select("event_date").eq("id", mine.next_post!.event_id).single();
    // 6 days before the event, at 09:30 in the store's zone (UTC).
    expect(new Date(mine.next_post!.post_at).toISOString()).toBe(`${plusDays(next!.event_date, -6)}T09:30:00.000Z`);
    // Once the server has a post for an event, the next post is a later one.
    await post(mine.next_post!.event_id);
    const after = must(await admin.rpc("bot_status", { p_guild_id: guild }), "status") as typeof status;
    expect(after.find((s) => s.store_id === storeId)!.next_post?.event_id).not.toBe(mine.next_post!.event_id);
  });

  it("unlink: a store manager, or anyone with Manage Server", async () => {
    const unlink = (discordId: string, manage: boolean, store = otherStoreId) =>
      admin.rpc("bot_unlink_store", {
        p_discord_id: discordId,
        p_guild_id: guild,
        p_store_id: store,
        p_has_manage_guild: manage,
      });
    expect(await errorOf(unlink(playerDiscord, false))).toBe("not_store_owner");
    // Manage Server works even without an ArmoryPal account.
    expect(must(await unlink(snowflake(), true), "unlink")).toBe(otherStoreId);
    expect(await errorOf(unlink(ownerDiscord, true))).toBe("store_not_linked");
    // With one link left, the store can be left out.
    expect(must(await admin.rpc("bot_update_settings", { p_discord_id: ownerDiscord, p_guild_id: guild }), "only link").store_id).toBe(
      storeId,
    );
  });
});

describe("outbox triggers", () => {
  it("queue nothing for events without a Discord post", async () => {
    const eventId = await oneOff();
    await player.client.rpc("attend_event", { p_event_id: eventId });
    expect(await pending(eventId)).toEqual([]);
  });

  it("coalesce a burst of changes into one refresh, and queue again after a claim", async () => {
    const eventId = await oneOff();
    await post(eventId);
    await player.client.rpc("attend_event", { p_event_id: eventId });
    await helper.client.rpc("attend_event", { p_event_id: eventId });
    must(
      await player.client.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "test-bot-red", quantity: 1 }] }),
      "add",
    );
    expect((await pending(eventId)).map((r) => r.kind)).toEqual(["refresh"]);

    // The worker claims it (refresh rows wait ~2 s to catch the rest of a burst).
    await admin.from("discord_outbox").update({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }).eq("event_id", eventId);
    const claimed = must(await admin.rpc("bot_claim_outbox", { p_limit: 100, p_ignore_pause: true }), "claim").filter((r) => r.event_id === eventId);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].attempts).toBe(1);
    expect(await pending(eventId)).toEqual([]);
    // A second claim doesn't hand out the same row.
    expect(must(await admin.rpc("bot_claim_outbox", { p_limit: 100, p_ignore_pause: true }), "claim").filter((r) => r.event_id === eventId)).toEqual([]);

    // A change during processing queues a fresh row.
    await helper.client.rpc("leave_event", { p_event_id: eventId, p_cancel_requests: false });
    expect((await pending(eventId)).map((r) => r.kind)).toEqual(["refresh"]);

    ok(await admin.rpc("bot_complete_outbox", { p_ids: [claimed[0].id] }), "complete");
    expect((await admin.from("discord_outbox").select("processed_at").eq("id", claimed[0].id).single()).data!.processed_at).not.toBeNull();
  });

  it("queue cancelled, moved and refresh for event changes", async () => {
    const moved = await oneOff("Move Armory");
    await post(moved);
    ok(await owner.client.rpc("owner_move_event", { p_event_id: moved, p_date: plusDays(today(), 3), p_start_time: "19:00" }), "move");
    expect((await pending(moved)).map((r) => r.kind)).toEqual(["moved"]);

    const renamed = await oneOff("Rename Armory");
    await post(renamed);
    ok(await owner.client.rpc("owner_rename_event", { p_event_id: renamed, p_label: "Renamed Armory" }), "rename");
    expect((await pending(renamed)).map((r) => r.kind)).toEqual(["refresh"]);

    const cancelled = await oneOff("Cancel Armory");
    await post(cancelled);
    ok(await owner.client.rpc("owner_cancel_event", { p_event_id: cancelled }), "cancel");
    expect((await pending(cancelled)).map((r) => r.kind)).toEqual(["cancelled"]);
  });

  it("deleting a one-off event queues deleting its messages, with the message list", async () => {
    const eventId = await oneOff("Delete Armory");
    await post(eventId);
    const { data: postRow } = await admin.from("discord_event_posts").select("message_id").eq("event_id", eventId).single();
    ok(await owner.client.rpc("owner_delete_event", { p_event_id: eventId }), "delete");
    const rows = await pending(eventId);
    const del = rows.find((r) => r.kind === "delete_posts");
    expect(del?.payload).toEqual({ posts: [{ guild_id: guild, channel_id: channel, message_id: postRow!.message_id }] });
    expect((await admin.from("events").select("id").eq("id", eventId)).data).toEqual([]);
  });

  it("deleting a weekly event (marker row) queues deleting its messages", async () => {
    const weekday = (new Date().getUTCDay() + 3) % 7;
    ok(await admin.from("store_schedules").insert({ store_id: storeId, weekday, start_time: "18:00", label: "Weekly Bot" }), "slot");
    const events = must(await player.client.rpc("current_events_for_stores", { p_store_ids: [storeId] }), "events");
    const weekly = events.find((e) => e.schedule_id !== null)!;
    await post(weekly.id);
    ok(await owner.client.rpc("owner_delete_event", { p_event_id: weekly.id }), "delete");
    expect((await pending(weekly.id)).map((r) => r.kind)).toContain("delete_posts");
    await admin.from("store_schedules").update({ active: false }).eq("store_id", storeId);
  });
});

describe("render data", () => {
  it("lists going in join order, kept requests and open requests by need", async () => {
    const eventId = await oneOff("Render Armory");
    await admin.rpc("bot_attend", { p_discord_id: playerDiscord, p_event_id: eventId });
    await helper.client.rpc("attend_event", { p_event_id: eventId });
    await follower.client.rpc("attend_event", { p_event_id: eventId });
    must(
      await player.client.rpc("add_requests", {
        p_event_id: eventId,
        p_items: [
          { card_id: "test-bot-red", quantity: 1 },
          { card_id: "test-bot-blue", quantity: 3 },
        ],
      }),
      "add",
    );
    must(
      await follower.client.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "test-bot-red", quantity: 2 }] }),
      "follower add",
    );
    const { data: blue } = await admin.from("requests").select("id").eq("event_id", eventId).eq("card_id", "test-bot-blue").single();
    expect((await helper.client.rpc("pledge", { p_request_id: blue!.id, p_quantity: 1 })).error).toBeNull();
    await follower.client.rpc("leave_event", { p_event_id: eventId, p_cancel_requests: false });

    const data = must(await admin.rpc("bot_render_event", { p_event_id: eventId }), "render") as {
      event: { label: string; one_off: boolean };
      store: { name: string; region: string };
      going: { name: string; requests: number }[];
      not_going: { name: string; requests: number }[];
      open_requests: { card: string; pitch: number; remaining: number; requester: string }[];
      open_count: number;
      request_count: number;
      poll: unknown;
    };
    expect(data.event).toMatchObject({ label: "Render Armory", one_off: true });
    expect(data.store).toMatchObject({ name: "Bot Test Store", region: "BT" });
    expect(data.going).toEqual([
      { name: "Bot Player", requests: 2 },
      { name: "Bot Helper", requests: 0 },
    ]);
    expect(data.not_going).toEqual([{ name: "Bot Follower", requests: 1 }]);
    expect(data.open_requests).toEqual([
      { card: "Bot Test Strike", pitch: 3, remaining: 2, requester: "Bot Player" },
      { card: "Bot Test Strike", pitch: 1, remaining: 1, requester: "Bot Player" },
      { card: "Bot Test Strike", pitch: 1, remaining: 2, requester: "Bot Follower" },
    ].sort((a, b) => b.remaining - a.remaining));
    expect(data.open_count).toBe(3);
    expect(data.request_count).toBe(3);
    expect(data.poll).toBeNull();

    const view = must(await admin.rpc("bot_event_requests", { p_discord_id: helperDiscord, p_event_id: eventId }), "requests") as {
      attending: boolean;
      requests: { card: string; pitch: number; my_pledge: number; is_mine: boolean; pledged: number }[];
    };
    expect(view.attending).toBe(true);
    expect(view.requests.find((r) => r.pitch === 3)).toMatchObject({ my_pledge: 1, pledged: 1, is_mine: false });
  });

  it("returns null for deleted events", async () => {
    const eventId = await oneOff();
    ok(await owner.client.rpc("owner_delete_event", { p_event_id: eventId }), "delete");
    expect((await admin.rpc("bot_render_event", { p_event_id: eventId })).data).toBeNull();
  });
});

describe("Discord DM queue", () => {
  const setPref = (u: TestUser, kind: string, channel: "app" | "discord", enabled: boolean) =>
    u.client
      .from("notification_preferences")
      .upsert({ user_id: u.id, kind, channel, enabled }, { onConflict: "user_id,kind,channel" });

  it("DMs are off by default, on only when the player opts in, and need Discord linked", async () => {
    const eventId = await oneOff("DM Armory");
    // Follower and owner hear about new requests (store saved / owner isn't in the audience otherwise).
    expect((await setPref(follower, "new_requests", "discord", true)).error).toBeNull();
    await unlinked.client.from("user_stores").insert({ store_id: storeId, user_id: unlinked.id });
    expect((await setPref(unlinked, "new_requests", "discord", true)).error).toBeNull();
    await helper.client.rpc("attend_event", { p_event_id: eventId }); // linked, but never opted in

    await player.client.rpc("attend_event", { p_event_id: eventId });
    must(
      await player.client.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "test-bot-red", quantity: 2 }] }),
      "add",
    );

    expect(await dmsFor(follower.id, eventId)).toEqual([
      { kind: "new_requests", discord_id: followerDiscord, payload: expect.objectContaining({ actor: "Bot Player", copies: 2 }) },
    ]);
    expect(await dmsFor(helper.id, eventId)).toEqual([]);
    expect(await dmsFor(unlinked.id, eventId)).toEqual([]);
    expect(await dmsFor(player.id, eventId)).toEqual([]); // the actor
    // In-app is independent: helper still got the in-app notification.
    const { data: inApp } = await helper.client.from("notifications").select("kind").eq("event_id", eventId);
    expect(inApp).toEqual([{ kind: "new_requests" }]);
  });

  it("turning in-app off doesn't stop the DM, and the DM channel only exists for DM kinds", async () => {
    const eventId = await oneOff("DM Armory 2");
    expect((await setPref(follower, "new_requests", "app", false)).error).toBeNull();
    expect((await setPref(follower, "event_moved", "discord", true)).error?.code).toBe("23514");
    await player.client.rpc("attend_event", { p_event_id: eventId });
    must(
      await player.client.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "test-bot-blue", quantity: 1 }] }),
      "add",
    );
    expect(await dmsFor(follower.id, eventId)).toHaveLength(1);
    expect((await follower.client.from("notifications").select("kind").eq("event_id", eventId)).data).toEqual([]);
    await setPref(follower, "new_requests", "app", true);
  });

  it("card_needed_again DMs go to the audience, not to the requester or releaser", async () => {
    const eventId = await oneOff("DM Armory 3");
    expect((await setPref(follower, "card_needed_again", "discord", true)).error).toBeNull();
    expect((await setPref(player, "card_needed_again", "discord", true)).error).toBeNull();
    await player.client.rpc("attend_event", { p_event_id: eventId });
    await helper.client.rpc("attend_event", { p_event_id: eventId });
    must(
      await player.client.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "test-bot-red", quantity: 1 }] }),
      "add",
    );
    const { data: req } = await admin.from("requests").select("id").eq("event_id", eventId).single();
    await helper.client.rpc("pledge", { p_request_id: req!.id, p_quantity: 1 });
    // Helper leaves from Discord: the card is needed again.
    ok(await admin.rpc("bot_leave", { p_discord_id: helperDiscord, p_event_id: eventId, p_cancel_requests: false }), "leave");

    expect((await dmsFor(follower.id, eventId)).map((d) => d.kind)).toContain("card_needed_again");
    expect((await dmsFor(player.id, eventId)).map((d) => d.kind)).not.toContain("card_needed_again");
    expect(await dmsFor(helper.id, eventId)).toEqual([]);
  });

  it("pauses DMs for a day after Discord refused one", async () => {
    const eventId = await oneOff("DM Armory 4");
    await admin.from("discord_dm_status").upsert({ user_id: follower.id, undeliverable_at: new Date().toISOString(), error_code: 50278 });
    await player.client.rpc("attend_event", { p_event_id: eventId });
    must(
      await player.client.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "test-bot-red", quantity: 1 }] }),
      "add",
    );
    expect(await dmsFor(follower.id, eventId)).toEqual([]);
    await admin.from("discord_dm_status").delete().eq("user_id", follower.id);
  });
});
