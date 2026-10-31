import { expect, test, uid, type Player } from "../support/fixtures";
import { E2E_STORE_ID } from "../support/env";
import { admin, currentEventId } from "../support/supabase";

/**
 * The admin moderation RPCs (bans, removals, store deletion, the players list
 * with emails) are the most powerful calls in the app. A regular player calling
 * them directly must be refused and change nothing; a banned player must not
 * be able to write anything.
 */

let mallory: Player;
let victim: Player;
let eventId: string;

test.beforeEach(async ({ newPlayer }) => {
  mallory = await newPlayer({ name: `Mallory ${uid()}` });
  victim = await newPlayer({ name: `Victim ${uid()}` });
  eventId = await currentEventId(victim.db, E2E_STORE_ID);
  await victim.db.rpc("attend_event", { p_event_id: eventId });
});

test("regular players can't use any admin RPC", async () => {
  const attempts: [string, () => PromiseLike<{ error: unknown; data?: unknown }>][] = [
    ["admin_ban", () => mallory.db.rpc("admin_ban", { p_user_id: victim.id, p_reason: "pwned" })],
    ["admin_unban", () => mallory.db.rpc("admin_unban", { p_user_id: victim.id })],
    ["admin_remove_attendee", () => mallory.db.rpc("admin_remove_attendee", { p_event_id: eventId, p_user_id: victim.id })],
    ["admin_delete_store", () => mallory.db.rpc("admin_delete_store", { p_store_id: E2E_STORE_ID })],
    ["admin_restore_store", () => mallory.db.rpc("admin_restore_store", { p_store_id: E2E_STORE_ID })],
    ["admin_list_players", () => mallory.db.rpc("admin_list_players", { p_query: "" })],
  ];
  const accepted: string[] = [];
  for (const [name, call] of attempts) {
    const { error, data } = await call();
    if (!error) accepted.push(`${name} → ${JSON.stringify(data)?.slice(0, 80)}`);
  }
  expect(accepted, "admin RPCs a regular player could call").toEqual([]);

  // Nothing changed.
  expect((await admin().from("bans").select("*").eq("user_id", victim.id)).data).toEqual([]);
  expect((await admin().from("attendances").select("user_id").eq("event_id", eventId).eq("user_id", victim.id)).data).toHaveLength(1);
  const { data: store } = await admin().from("stores").select("archived_at").eq("id", E2E_STORE_ID).single();
  expect(store?.archived_at).toBeNull();
});

test("regular players can't read bans or the admin log, or write them directly", async () => {
  // Give the tables something to hide.
  const boss = await admin().auth.admin.createUser({ email: `boss-${uid()}@example.com`, password: `pw-${uid()}-x`, email_confirm: true });
  await admin().from("profiles").update({ display_name: "Boss", is_admin: true }).eq("id", boss.data.user!.id);
  await admin().from("bans").insert({ user_id: victim.id, reason: "secret reason", banned_by: boss.data.user!.id });

  expect((await mallory.db.from("bans").select("*")).data ?? []).toEqual([]);
  expect((await mallory.db.from("admin_actions").select("*")).data ?? []).toEqual([]);
  await mallory.db.from("bans").delete().eq("user_id", victim.id);
  await mallory.db.from("bans").insert({ user_id: mallory.id, reason: "x", banned_by: mallory.id });
  await mallory.db.from("admin_actions").insert({ action: "fake", admin_id: mallory.id });

  expect((await admin().from("bans").select("user_id").eq("user_id", victim.id)).data).toHaveLength(1);
  expect((await admin().from("bans").select("user_id").eq("user_id", mallory.id)).data).toEqual([]);
  expect((await admin().from("admin_actions").select("id").eq("action", "fake")).data).toEqual([]);

  // The banned player sees their own reason, nobody else's.
  expect((await victim.db.from("bans").select("reason")).data).toEqual([{ reason: "secret reason" }]);

  await admin().from("bans").delete().eq("user_id", victim.id);
  await admin().auth.admin.deleteUser(boss.data.user!.id);
});

test("a banned player can't write anything", async ({ newPlayer }) => {
  const boss = await newPlayer({ name: `Boss ${uid()}`, isAdmin: true });
  await victim.db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "e2e-sledge", quantity: 1 }], p_note: "" });
  expect((await boss.db.rpc("admin_ban", { p_user_id: victim.id, p_reason: "test" })).error).toBeNull();

  const writes: [string, () => PromiseLike<{ error: unknown }>][] = [
    ["attend_event", () => victim.db.rpc("attend_event", { p_event_id: eventId })],
    ["add_requests", () => victim.db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "e2e-sledge", quantity: 1 }], p_note: "" })],
    ["profile update", () => victim.db.from("profiles").update({ display_name: "Still here" }).eq("id", victim.id).select()],
    ["follow store", () => victim.db.from("user_stores").insert({ user_id: victim.id, store_id: E2E_STORE_ID }).select()],
    ["notification prefs", () => victim.db.from("notification_preferences").insert({ user_id: victim.id, kind: "new_requests", enabled: false }).select()],
  ];
  const accepted: string[] = [];
  for (const [label, call] of writes) {
    const res = (await call()) as { error: unknown; data?: unknown[] };
    // RLS can "succeed" with zero rows; count that as refused.
    if (!res.error && (res.data === undefined || (Array.isArray(res.data) && res.data.length > 0))) accepted.push(label);
  }
  expect(accepted, "writes a banned player could still make").toEqual([]);

  // The ban took them off the event and cancelled their open request.
  expect((await admin().from("attendances").select("user_id").eq("event_id", eventId).eq("user_id", victim.id)).data).toEqual([]);
  const { data: reqs } = await admin().from("requests").select("status").eq("requester_id", victim.id);
  expect(reqs?.every((r) => r.status === "cancelled")).toBe(true);
  const { data: profile } = await admin().from("profiles").select("display_name").eq("id", victim.id).single();
  expect(profile?.display_name).toBe(victim.name);

  // Admins can't be banned, and can't ban themselves.
  expect((await boss.db.rpc("admin_ban", { p_user_id: boss.id, p_reason: "x" })).error).not.toBeNull();
  await admin().from("bans").delete().eq("user_id", victim.id);
});

test("the admin players list (emails) is admin-only, also through the pages", async ({ newPlayer }) => {
  for (const path of ["/admin/players", `/admin/players/${victim.id}`, "/admin/log"]) {
    expect((await mallory.page.goto(path))?.status(), path).toBe(404);
  }
  const boss = await newPlayer({ isAdmin: true });
  const { data, error } = await boss.db.rpc("admin_list_players", { p_query: victim.name });
  expect(error).toBeNull();
  expect(data?.some((p) => p.id === victim.id && p.email === victim.email)).toBe(true);
});
