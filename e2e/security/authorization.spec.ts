import { expect, test, uid, type Player } from "../support/fixtures";
import { E2E_STORE_ID } from "../support/env";
import { admin, currentEventId } from "../support/supabase";

/**
 * A signed-in attacker ("mallory") calling the database API directly, the way
 * a malicious user with the browser dev tools would. Every attempt must fail
 * AND leave the stored data unchanged (checked with the service role).
 */

let eventId: string;
let alice: Player;
let mallory: Player;
let aliceRequestId: string;

test.beforeEach(async ({ newPlayer }) => {
  alice = await newPlayer({ name: `Alice ${uid()}` });
  mallory = await newPlayer({ name: `Mallory ${uid()}` });
  eventId = await currentEventId(alice.db, E2E_STORE_ID);
  for (const p of [alice, mallory]) expect((await p.db.rpc("attend_event", { p_event_id: eventId })).error).toBeNull();
  const { error } = await alice.db.rpc("add_requests", {
    p_event_id: eventId,
    p_items: [{ card_id: "e2e-snatch-red", quantity: 3 }],
    p_note: "alice's note",
  });
  expect(error).toBeNull();
  const { data } = await admin()
    .from("requests")
    .select("id")
    .eq("event_id", eventId)
    .eq("requester_id", alice.id)
    .eq("status", "active")
    .single();
  aliceRequestId = data!.id;
});

const aliceRequest = async () =>
  (await admin().from("requests").select("quantity, note, status").eq("id", aliceRequestId).single()).data;

test("can't edit or cancel someone else's request", async () => {
  const before = await aliceRequest();

  expect((await mallory.db.rpc("update_request", { p_request_id: aliceRequestId, p_quantity: 1, p_note: "pwned" })).error).not.toBeNull();
  expect((await mallory.db.rpc("cancel_request", { p_request_id: aliceRequestId })).error).not.toBeNull();
  // Direct table writes (bypassing the RPCs) are blocked by grants/RLS.
  await mallory.db.from("requests").update({ quantity: 1, note: "pwned" }).eq("id", aliceRequestId);
  await mallory.db.from("requests").delete().eq("id", aliceRequestId);
  await mallory.db.from("requests").insert({ event_id: eventId, requester_id: alice.id, card_id: "e2e-sledge", quantity: 20 });

  expect(await aliceRequest()).toEqual(before);
  const { count } = await admin().from("requests").select("*", { count: "exact", head: true }).eq("requester_id", alice.id);
  expect(count).toBe(1);
});

test("can't forge, inflate or remove someone else's pledge", async () => {
  // Alice promises to bring 1 of the 2 cards mallory asked for.
  const { error } = await mallory.db.rpc("add_requests", {
    p_event_id: eventId,
    p_items: [{ card_id: "e2e-sledge", quantity: 2 }],
    p_note: "",
  });
  expect(error).toBeNull();
  const { data: mReq } = await admin().from("requests").select("id").eq("requester_id", mallory.id).single();
  expect((await alice.db.rpc("pledge", { p_request_id: mReq!.id, p_quantity: 1 })).error).toBeNull();

  // Mallory tries to make alice bring 2, delete alice's pledge, or pledge in alice's name.
  await mallory.db.from("pledges").update({ quantity: 2 }).eq("request_id", mReq!.id);
  await mallory.db.from("pledges").delete().eq("request_id", mReq!.id);
  await mallory.db.from("pledges").insert({ event_id: eventId, request_id: aliceRequestId, pledger_id: alice.id, quantity: 3 });

  const { data: pledges } = await admin().from("pledges").select("request_id, pledger_id, quantity");
  const relevant = pledges!.filter((p) => p.request_id === mReq!.id || p.request_id === aliceRequestId);
  expect(relevant).toEqual([{ request_id: mReq!.id, pledger_id: alice.id, quantity: 1 }]);
});

test("pledge and request rules hold against crafted input", async () => {
  const bad: [string, () => PromiseLike<{ error: unknown }>][] = [
    ["pledge on own request", () => alice.db.rpc("pledge", { p_request_id: aliceRequestId, p_quantity: 1 })],
    ["pledge 0", () => mallory.db.rpc("pledge", { p_request_id: aliceRequestId, p_quantity: 0 })],
    ["pledge negative", () => mallory.db.rpc("pledge", { p_request_id: aliceRequestId, p_quantity: -5 })],
    ["pledge more than needed", () => mallory.db.rpc("pledge", { p_request_id: aliceRequestId, p_quantity: 4 })],
    ["pledge huge", () => mallory.db.rpc("pledge", { p_request_id: aliceRequestId, p_quantity: 2_147_483_647 })],
    ["request 0", () => mallory.db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "e2e-sledge", quantity: 0 }], p_note: "" })],
    ["request 21", () => mallory.db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "e2e-sledge", quantity: 21 }], p_note: "" })],
    ["request text qty", () => mallory.db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "e2e-sledge", quantity: "1; drop table cards" }], p_note: "" })],
    ["request unknown card", () => mallory.db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "nope", quantity: 1 }], p_note: "" })],
    ["request items not a list", () => mallory.db.rpc("add_requests", { p_event_id: eventId, p_items: { card_id: "e2e-sledge", quantity: 1 }, p_note: "" })],
    ["request note 201 chars", () => mallory.db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "e2e-sledge", quantity: 1 }], p_note: "x".repeat(201) })],
    ["request on unknown event", () => mallory.db.rpc("add_requests", { p_event_id: "00000000-0000-4000-a000-000000000000", p_items: [{ card_id: "e2e-sledge", quantity: 1 }], p_note: "" })],
    ["attend unknown event", () => mallory.db.rpc("attend_event", { p_event_id: "00000000-0000-4000-a000-000000000000" })],
    ["lower below pledged", async () => {
      await mallory.db.rpc("pledge", { p_request_id: aliceRequestId, p_quantity: 2 });
      return alice.db.rpc("update_request", { p_request_id: aliceRequestId, p_quantity: 1, p_note: "" });
    }],
  ];

  const accepted: string[] = [];
  for (const [label, call] of bad) if (!(await call()).error) accepted.push(label);
  expect(accepted, "crafted calls the database accepted").toEqual([]);

  // Nothing slipped in: mallory has no requests, alice's still asks for 3 with 2 pledged.
  const { count } = await admin().from("requests").select("*", { count: "exact", head: true }).eq("requester_id", mallory.id);
  expect(count).toBe(0);
  expect((await aliceRequest())?.quantity).toBe(3);
});

test("someone who isn't going can't request or pledge", async ({ newPlayer }) => {
  const outsider = await newPlayer();
  expect((await outsider.db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "e2e-sledge", quantity: 1 }], p_note: "" })).error).not.toBeNull();
  expect((await outsider.db.rpc("pledge", { p_request_id: aliceRequestId, p_quantity: 1 })).error).not.toBeNull();
  // …nor mark someone else as attending.
  await outsider.db.from("attendances").insert({ event_id: eventId, user_id: outsider.id });
  const { count } = await admin().from("attendances").select("*", { count: "exact", head: true }).eq("user_id", outsider.id);
  expect(count).toBe(0);
});

test("can't become admin, edit others' profiles, or manage stores", async () => {
  // Self-promotion: is_admin isn't writable by users.
  const promote = await mallory.db.from("profiles").update({ is_admin: true }).eq("id", mallory.id);
  expect(promote.error).not.toBeNull();
  // Renaming someone else.
  await mallory.db.from("profiles").update({ display_name: "pwned" }).eq("id", alice.id);
  // Store admin without being admin.
  await mallory.db.from("stores").update({ notes: "pwned" }).eq("id", E2E_STORE_ID);
  await mallory.db.from("stores").insert({ name: "Mallory's Fake Store", city: "X", country: "X", timezone: "UTC" });
  await mallory.db.from("store_schedules").update({ active: false }).eq("store_id", E2E_STORE_ID);

  const { data: profiles } = await admin().from("profiles").select("id, display_name, is_admin").in("id", [alice.id, mallory.id]);
  expect(profiles!.find((p) => p.id === mallory.id)?.is_admin).toBe(false);
  expect(profiles!.find((p) => p.id === alice.id)?.display_name).toBe(alice.name);
  const { data: store } = await admin().from("stores").select("notes").eq("id", E2E_STORE_ID).single();
  expect(store?.notes ?? "").not.toBe("pwned");
  expect((await admin().from("stores").select("id").eq("name", "Mallory's Fake Store")).data).toEqual([]);
  expect((await admin().from("store_schedules").select("active").eq("store_id", E2E_STORE_ID)).data?.every((s) => s.active)).toBe(true);

  // The admin pages hide behind a 404.
  for (const path of ["/admin", "/admin/stores/new", `/admin/stores/${E2E_STORE_ID}`]) {
    expect((await mallory.page.goto(path))?.status(), path).toBe(404);
  }
});

test("can't read or clear someone else's notifications or settings", async () => {
  // Mallory's request notifies alice (new_requests).
  await mallory.db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "e2e-sledge", quantity: 1 }], p_note: "" });
  const aliceUnread = async () =>
    (await admin().from("notifications").select("*", { count: "exact", head: true }).eq("user_id", alice.id).is("read_at", null)).count;
  await expect.poll(aliceUnread).toBeGreaterThan(0);
  const before = await aliceUnread();

  expect((await mallory.db.from("notifications").select("*").eq("user_id", alice.id)).data).toEqual([]);
  await mallory.db.rpc("mark_notifications_read"); // only marks mallory's own
  await mallory.db.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", alice.id);
  await mallory.db.from("notifications").delete().eq("user_id", alice.id);
  expect(await aliceUnread()).toBe(before);

  // Notification preferences: can't switch alice's off, or plant rows in her name.
  await mallory.db.from("notification_preferences").insert({ user_id: alice.id, kind: "new_requests", enabled: false });
  expect((await admin().from("notification_preferences").select("*").eq("user_id", alice.id)).data).toEqual([]);
});

test("can't add stores to someone else's list", async () => {
  await mallory.db.from("user_stores").insert({ user_id: alice.id, store_id: E2E_STORE_ID });
  expect((await admin().from("user_stores").select("*").eq("user_id", alice.id)).data).toEqual([]);
});

test("realtime: a user's private notification channel is private", async () => {
  type Status = string;
  const listen = (p: Player, topic: string) => {
    const received: unknown[] = [];
    let status: Status = "";
    const channel = p.db
      .channel(topic, { config: { private: true } })
      .on("broadcast", { event: "notification" }, (m) => received.push(m))
      .subscribe((s) => (status = s));
    return { received, channel, status: () => status };
  };

  // Realtime authorizes private channels with the user's JWT.
  for (const p of [alice, mallory]) {
    const { data } = await p.db.auth.getSession();
    await p.db.realtime.setAuth(data.session!.access_token);
  }

  const own = listen(alice, `user:${alice.id}`);
  const snoop = listen(mallory, `user:${alice.id}`);
  await expect.poll(own.status, { message: "alice's own channel connects" }).toBe("SUBSCRIBED");
  await new Promise((r) => setTimeout(r, 1000)); // give mallory's join the same chance

  // Trigger a notification for alice.
  await mallory.db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "e2e-sledge", quantity: 1 }], p_note: "" });
  await expect.poll(() => own.received.length, { message: "positive control: alice receives it" }).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 1500));
  expect(snoop.received, "mallory must not receive alice's notifications").toEqual([]);

  await own.channel.unsubscribe();
  await snoop.channel.unsubscribe();
});
