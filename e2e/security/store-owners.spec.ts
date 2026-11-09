import { expect, test, uid, type Player } from "../support/fixtures";
import { admin } from "../support/supabase";

/**
 * Store-owner powers stay with the store's owners: other players can't open
 * the owner screens or call the owner RPCs, owners can't reach other stores,
 * and links can't carry scripts or plain http.
 */

let storeId: string;
let otherStoreId: string;
let eventId: string;
let owner: Player;
let mallory: Player;

async function newStore(name: string) {
  const { data, error } = await admin()
    .from("stores")
    .insert({ name, city: "Secureville", country: "Testland", timezone: "UTC" })
    .select("id")
    .single();
  if (error) throw error;
  await admin()
    .from("store_schedules")
    .insert({ store_id: data.id, weekday: (new Date().getUTCDay() + 3) % 7, start_time: "18:00" });
  return data.id as string;
}

test.beforeEach(async ({ newPlayer }) => {
  owner = await newPlayer({ name: `Owner ${uid()}` });
  mallory = await newPlayer({ name: `Mallory ${uid()}` });
  storeId = await newStore(`Owned Store ${uid()}`);
  otherStoreId = await newStore(`Other Store ${uid()}`);
  await admin().from("store_owners").insert({ store_id: storeId, user_id: owner.id });
  const { data } = await owner.db.rpc("current_events_for_stores", { p_store_ids: [storeId] });
  eventId = data![0].id;
});

test.afterEach(async () => {
  await admin().from("events").delete().in("store_id", [storeId, otherStoreId]);
  await admin().from("stores").delete().in("id", [storeId, otherStoreId]);
});

test("non-owners get a 404 on the owner screens", async () => {
  for (const path of [`/manage/stores/${storeId}`, `/manage/events/${eventId}`, "/manage"]) {
    const res = await mallory.page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
  // The owner can open theirs, but not another store's.
  expect((await owner.page.goto(`/manage/stores/${storeId}`))?.status()).toBe(200);
  expect((await owner.page.goto(`/manage/stores/${otherStoreId}`))?.status()).toBe(404);
});

test("non-owners can't call the owner RPCs, and nothing changes", async () => {
  const before = (await admin().from("events").select("*").eq("id", eventId).single()).data;
  const attempts = await Promise.all([
    mallory.db.rpc("owner_update_event_links", {
      p_event_id: eventId,
      p_gem_url: "",
      p_gem_code: "666",
      p_ticket_url: "https://phish.example.com",
    }),
    mallory.db.rpc("owner_move_event", { p_event_id: eventId, p_date: "2099-01-01", p_start_time: "03:00" }),
    mallory.db.rpc("owner_create_event", {
      p_store_id: storeId,
      p_label: "Fake",
      p_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      p_start_time: "12:00",
    }),
    mallory.db.rpc("owner_open_poll", { p_event_id: eventId, p_options: ["draft", "cc"] }),
    mallory.db.rpc("owner_confirm_format", { p_event_id: eventId, p_format: "draft" }),
    mallory.db.rpc("owner_update_store_info", { p_store_id: storeId, p_notes: "pwned", p_ticket_url: "" }),
    mallory.db.rpc("owner_upcoming_events", { p_store_id: storeId }),
    // An owner can't reach another store either.
    owner.db.rpc("owner_update_store_info", { p_store_id: otherStoreId, p_notes: "pwned", p_ticket_url: "" }),
  ]);
  for (const a of attempts) expect(a.error?.message).toBe("not_store_owner");

  // Nor make themselves an owner, or approve their own request.
  const self = await mallory.db.from("store_owners").insert({ store_id: storeId, user_id: mallory.id });
  expect(self.error).not.toBeNull();
  await mallory.db.rpc("request_store_ownership", { p_store_id: storeId });
  const { data: req } = await admin()
    .from("store_owner_requests")
    .select("id")
    .eq("user_id", mallory.id)
    .eq("status", "pending")
    .single();
  const approve = await mallory.db.rpc("admin_decide_ownership_request", { p_request_id: req!.id, p_approve: true });
  expect(approve.error?.message).toBe("not_admin");

  const after = (await admin().from("events").select("*").eq("id", eventId).single()).data;
  expect(after).toEqual(before);
  const { data: owners } = await admin().from("store_owners").select("user_id").eq("store_id", storeId);
  expect(owners).toEqual([{ user_id: owner.id }]);
});

test("links must be https, and GEM links must point at fabtcg.com", async () => {
  for (const ticket of ["javascript:alert(1)", "http://shop.example.com", "data:text/html,<script>alert(1)</script>"]) {
    const { error } = await owner.db.rpc("owner_update_event_links", {
      p_event_id: eventId,
      p_gem_url: "",
      p_gem_code: "",
      p_ticket_url: ticket,
    });
    expect(error?.message, ticket).toBe("invalid_ticket_link");
  }
  for (const gem of ["https://fabtcg.com.evil.example/", "javascript://gem.fabtcg.com/%0aalert(1)"]) {
    const { error } = await owner.db.rpc("owner_update_event_links", {
      p_event_id: eventId,
      p_gem_url: gem,
      p_gem_code: "",
      p_ticket_url: "",
    });
    expect(error?.message, gem).toBe("invalid_gem_link");
  }
  const code = await owner.db.rpc("owner_update_event_links", {
    p_event_id: eventId,
    p_gem_url: "",
    p_gem_code: "<img src=x onerror=alert(1)>",
    p_ticket_url: "",
  });
  expect(code.error?.message).toBe("invalid_gem_link");
});
