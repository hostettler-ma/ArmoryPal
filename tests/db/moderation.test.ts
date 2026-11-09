import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

const CARDS = [{ id: "test-mod-card", name: "Moderation Test Strike", pitch: 1, color: "Red", types: ["Generic"] }];

let mod: TestUser; // admin
let player: TestUser; // gets removed / banned
let other: TestUser; // trades with player
let storeId: string;
let scheduleId: string;
let eventId: string;
let pastEventId: string;
const storeIds: string[] = [];

/** `player` requests 2 cards that `other` pledges 1 of, and pledges 1 on `other`'s request. */
async function setUpTrades(event = eventId) {
  for (const u of [player, other]) await u.client.rpc("attend_event", { p_event_id: event });
  const add = (u: TestUser) =>
    u.client.rpc("add_requests", { p_event_id: event, p_items: [{ card_id: "test-mod-card", quantity: 2 }] });
  await add(player);
  await add(other);
  const { data: reqs } = await admin
    .from("requests")
    .select("id, requester_id")
    .eq("event_id", event)
    .eq("status", "active");
  const mine = reqs!.find((r) => r.requester_id === player.id)!.id;
  const theirs = reqs!.find((r) => r.requester_id === other.id)!.id;
  expect((await other.client.rpc("pledge", { p_request_id: mine, p_quantity: 1 })).error).toBeNull();
  expect((await player.client.rpc("pledge", { p_request_id: theirs, p_quantity: 1 })).error).toBeNull();
  return { mine, theirs };
}

async function newStore(name: string) {
  const { data } = await admin
    .from("stores")
    .insert({ name, city: "Modville", country: "Testland", timezone: "UTC" })
    .select()
    .single();
  storeIds.push(data!.id);
  return data!.id as string;
}

beforeAll(async () => {
  await admin.from("cards").upsert(CARDS);
  [mod, player, other] = await Promise.all([
    createTestUser({ name: "Moderator", isAdmin: true }),
    createTestUser({ name: "Mod Player" }),
    createTestUser({ name: "Mod Other" }),
  ]);
  storeId = await newStore("Moderation Test Store");
  const { data: sched } = await admin
    .from("store_schedules")
    .insert({ store_id: storeId, weekday: 4, start_time: "18:00" })
    .select()
    .single();
  scheduleId = sched!.id;
  const { data: events } = await mod.client.rpc("current_events_for_stores", { p_store_ids: [storeId] });
  eventId = events![0].id;

  const { data: past } = await admin
    .from("events")
    .insert({
      schedule_id: scheduleId,
      label: "Armory",
      store_id: storeId,
      event_date: "2026-01-08",
      starts_at: "2026-01-08T18:00:00Z",
      ends_at: "2026-01-09T00:00:00Z",
    })
    .select()
    .single();
  pastEventId = past!.id;
  await admin.from("attendances").insert({ event_id: pastEventId, user_id: player.id });
});

afterAll(async () => {
  await admin.from("admin_actions").delete().in("target_store", storeIds);
  await admin.from("admin_actions").delete().in("target_user", [player.id, other.id]);
  await admin.from("events").delete().in("store_id", storeIds);
  await admin.from("stores").delete().in("id", storeIds);
  await admin.from("cards").delete().in("id", CARDS.map((c) => c.id));
  await deleteTestUsers();
});

describe("admin-only access", () => {
  it("rejects non-admins on every admin RPC", async () => {
    const calls = [
      player.client.rpc("admin_remove_attendee", { p_event_id: eventId, p_user_id: other.id }),
      player.client.rpc("admin_ban", { p_user_id: other.id, p_reason: "x" }),
      player.client.rpc("admin_unban", { p_user_id: other.id }),
      player.client.rpc("admin_delete_store", { p_store_id: storeId }),
      player.client.rpc("admin_restore_store", { p_store_id: storeId }),
      player.client.rpc("admin_list_players", { p_query: "" }),
    ];
    for (const { error } of await Promise.all(calls)) expect(error?.message).toBe("not_admin");
  });

  it("hides bans and the admin log from players", async () => {
    await admin.from("bans").insert({ user_id: other.id, reason: "test" });
    expect((await player.client.from("bans").select("user_id")).data).toEqual([]);
    expect((await player.client.from("admin_actions").select("id")).data).toEqual([]);
    await admin.from("bans").delete().eq("user_id", other.id);
  });

  it("keeps internal helpers and admin RPCs away from the API", async () => {
    // Not in the generated types on purpose (internal helper), hence the casts.
    const remove = await player.client.rpc("remove_from_event" as never, { p_event_id: eventId, p_user_id: other.id } as never);
    expect(remove.error?.message).toMatch(/permission denied/);
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false },
    });
    for (const fn of ["admin_ban", "admin_list_players", "is_banned", "admin_delete_store"]) {
      const { error } = await anon.rpc(fn as never, {});
      expect(error, fn).not.toBeNull();
    }
  });

  it("lists players with email for admins", async () => {
    const { data, error } = await mod.client.rpc("admin_list_players", { p_query: "Mod Player" });
    expect(error).toBeNull();
    expect(data).toEqual([expect.objectContaining({ id: player.id, email: player.email, banned: false })]);
  });
});

describe("admin_remove_attendee", () => {
  it("releases pledges, cancels requests, notifies everyone, and logs it", async () => {
    const { mine, theirs } = await setUpTrades();
    const { error } = await mod.client.rpc("admin_remove_attendee", {
      p_event_id: eventId,
      p_user_id: player.id,
      p_reason: "No-show",
    });
    expect(error).toBeNull();

    const { data: attending } = await admin.from("attendances").select("user_id").eq("event_id", eventId);
    expect(attending!.map((a) => a.user_id)).not.toContain(player.id);
    const { data: req } = await admin.from("requests").select("status").eq("id", mine).single();
    expect(req!.status).toBe("cancelled");
    const { data: pledges } = await admin.from("pledges").select("id").in("request_id", [mine, theirs]);
    expect(pledges).toEqual([]);

    const { data: toOther } = await admin
      .from("notifications")
      .select("kind, payload")
      .eq("user_id", other.id)
      .eq("event_id", eventId)
      .in("kind", ["pledge_released", "request_cancelled"]);
    expect(toOther!.map((n) => n.kind).sort()).toEqual(["pledge_released", "request_cancelled"]);
    for (const n of toOther!) expect(n.payload).toMatchObject({ actor: "Mod Player", reason: "removed" });

    const { data: toPlayer } = await admin
      .from("notifications")
      .select("payload")
      .eq("user_id", player.id)
      .eq("kind", "removed_from_event")
      .single();
    expect(toPlayer!.payload).toEqual({ note: "No-show" });

    const { data: log } = await mod.client
      .from("admin_actions")
      .select("action, target_label, detail")
      .eq("target_event", eventId)
      .eq("target_user", player.id);
    expect(log).toEqual([{ action: "remove_attendee", target_label: "Mod Player", detail: "No-show" }]);
  });

  it("rejects players who aren't attending and ended events", async () => {
    const notGoing = await mod.client.rpc("admin_remove_attendee", { p_event_id: eventId, p_user_id: player.id });
    expect(notGoing.error?.message).toBe("not_attending");
    const ended = await mod.client.rpc("admin_remove_attendee", { p_event_id: pastEventId, p_user_id: player.id });
    expect(ended.error?.message).toBe("event_ended");
  });
});

describe("admin_ban", () => {
  it("validates the target and reason", async () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["self", { p_user_id: mod.id, p_reason: "x" }, "cannot_ban_self"],
      ["no reason", { p_user_id: player.id, p_reason: "  " }, "invalid_reason"],
      ["long reason", { p_user_id: player.id, p_reason: "x".repeat(201) }, "invalid_reason"],
    ];
    for (const [label, args, code] of cases) {
      const { error } = await mod.client.rpc("admin_ban", args as never);
      expect(error?.message, label).toBe(code);
    }
    const otherAdmin = await createTestUser({ name: "Other Admin", isAdmin: true });
    const { error } = await mod.client.rpc("admin_ban", { p_user_id: otherAdmin.id, p_reason: "x" });
    expect(error?.message).toBe("cannot_ban_admin");
  });

  it("removes the player from open events only, then blocks every write", async () => {
    await setUpTrades();
    const { error } = await mod.client.rpc("admin_ban", { p_user_id: player.id, p_reason: "Kept cards" });
    expect(error).toBeNull();

    const { data: open } = await admin.from("attendances").select("user_id").eq("event_id", eventId);
    expect(open!.map((a) => a.user_id)).not.toContain(player.id);
    const { data: past } = await admin.from("attendances").select("user_id").eq("event_id", pastEventId);
    expect(past!.map((a) => a.user_id)).toContain(player.id); // history untouched
    const { data: active } = await admin
      .from("requests")
      .select("id")
      .eq("event_id", eventId)
      .eq("requester_id", player.id)
      .eq("status", "active");
    expect(active).toEqual([]);

    expect((await player.client.rpc("attend_event", { p_event_id: eventId })).error?.message).toBe("banned");
    const { data: theirs } = await admin
      .from("requests")
      .select("id")
      .eq("event_id", eventId)
      .eq("requester_id", other.id)
      .eq("status", "active")
      .single();
    expect((await player.client.rpc("pledge", { p_request_id: theirs!.id, p_quantity: 1 })).error?.message).toBe(
      "banned",
    );
    const follow = await player.client.from("user_stores").insert({ user_id: player.id, store_id: storeId });
    expect(follow.error).not.toBeNull();
    const rename = await player.client.from("profiles").update({ display_name: "Renamed" }).eq("id", player.id).select();
    expect(rename.data).toEqual([]);

    // They can read their own ban (for the suspended page), others can't.
    expect((await player.client.from("bans").select("reason").single()).data).toEqual({ reason: "Kept cards" });
    expect((await other.client.from("bans").select("user_id")).data).toEqual([]);

    expect((await mod.client.rpc("admin_ban", { p_user_id: player.id, p_reason: "again" })).error?.message).toBe(
      "already_banned",
    );
  });

  it("unban restores access and both are logged", async () => {
    expect((await mod.client.rpc("admin_unban", { p_user_id: player.id })).error).toBeNull();
    expect((await player.client.rpc("attend_event", { p_event_id: eventId })).error).toBeNull();
    expect((await mod.client.rpc("admin_unban", { p_user_id: player.id })).error?.message).toBe("not_banned");

    const { data: log } = await mod.client
      .from("admin_actions")
      .select("action")
      .eq("target_user", player.id)
      .in("action", ["ban", "unban"])
      .order("id");
    expect(log!.map((l) => l.action)).toEqual(["ban", "unban"]);
  });
});

describe("admin_delete_store", () => {
  it("archives a store with event history and hides it from search", async () => {
    const { data, error } = await mod.client.rpc("admin_delete_store", { p_store_id: storeId });
    expect(error).toBeNull();
    expect(data).toBe("archived");

    const { data: store } = await admin.from("stores").select("archived_at").eq("id", storeId).single();
    expect(store!.archived_at).not.toBeNull();
    const { data: sched } = await admin.from("store_schedules").select("active").eq("id", scheduleId).single();
    expect(sched!.active).toBe(false);
    const { data: found } = await player.client.rpc("search_stores", { q: "Moderation Test Store" });
    expect(found).toEqual([]);
    const { data: events } = await admin.from("events").select("id").eq("store_id", storeId);
    expect(events!.length).toBeGreaterThan(0); // history kept
  });

  it("restores an archived store", async () => {
    expect((await mod.client.rpc("admin_restore_store", { p_store_id: storeId })).error).toBeNull();
    const { data: found } = await player.client.rpc("search_stores", { q: "Moderation Test Store" });
    expect(found!.map((s) => s.id)).toContain(storeId);
    expect((await mod.client.rpc("admin_restore_store", { p_store_id: storeId })).error?.message).toBe(
      "store_not_archived",
    );
  });

  it("deletes a store that never had an event, and logs every outcome", async () => {
    const emptyId = await newStore("Moderation Empty Store");
    const { data } = await mod.client.rpc("admin_delete_store", { p_store_id: emptyId });
    expect(data).toBe("deleted");
    expect((await admin.from("stores").select("id").eq("id", emptyId)).data).toEqual([]);

    const { data: log } = await mod.client
      .from("admin_actions")
      .select("action, target_store")
      .in("target_store", [storeId, emptyId])
      .order("id");
    expect(log!.map((l) => l.action)).toEqual(["archive_store", "restore_store", "delete_store"]);
  });
});
