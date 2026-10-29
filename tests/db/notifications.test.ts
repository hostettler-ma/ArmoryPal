import type { RealtimeChannel } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

const CARD = { id: "test-nt-red", name: "Notify Test Strike", pitch: 1, color: "Red", types: ["Generic"] };
const CARD2 = { id: "test-nt-blue", name: "Notify Test Strike", pitch: 3, color: "Blue", types: ["Generic"] };

let rhea: TestUser; // requester
let tomas: TestUser; // bringer
let uma: TestUser; // another bringer
let storeId: string;
let eventId: string;

beforeAll(async () => {
  await admin.from("cards").upsert([CARD, CARD2]);
  [rhea, tomas, uma] = await Promise.all([
    createTestUser({ name: "Rhea" }),
    createTestUser({ name: "Tomas" }),
    createTestUser({ name: "Uma" }),
  ]);
  const { data: store } = await admin
    .from("stores")
    .insert({ name: "Notify Test Store", city: "Testville", country: "Testland", timezone: "UTC" })
    .select()
    .single();
  storeId = store!.id;
  await admin.from("store_schedules").insert({ store_id: storeId, weekday: 4, start_time: "18:00" });
  const { data: events } = await rhea.client.rpc("current_events_for_stores", { p_store_ids: [storeId] });
  eventId = events![0].id;
});

afterAll(async () => {
  await admin.from("events").delete().eq("store_id", storeId);
  await admin.from("stores").delete().eq("id", storeId);
  await admin.from("cards").delete().in("id", [CARD.id, CARD2.id]);
  await deleteTestUsers();
});

async function attendAll() {
  for (const u of [rhea, tomas, uma]) await u.client.rpc("attend_event", { p_event_id: eventId });
}

async function freshRequest(qty: number): Promise<string> {
  const { data: active } = await admin
    .from("requests")
    .select("id")
    .eq("event_id", eventId)
    .eq("requester_id", rhea.id)
    .eq("status", "active");
  for (const r of active ?? []) await admin.from("requests").update({ status: "cancelled" }).eq("id", r.id);
  const { data, error } = await rhea.client.rpc("add_requests", {
    p_event_id: eventId,
    p_items: [{ card_id: CARD.id, quantity: qty }],
  });
  if (error) throw error;
  return data![0].id;
}

/** The user's notifications (optionally only some kinds), oldest first, as they see them. */
async function inbox(u: TestUser, ...kinds: string[]) {
  let q = u.client.from("notifications").select("kind, payload, event_id, read_at").order("created_at");
  if (kinds.length) q = q.in("kind", kinds);
  const { data } = await q;
  return data ?? [];
}

async function clearInboxes() {
  await admin.from("notifications").delete().in("user_id", [rhea.id, tomas.id, uma.id]);
}

describe("notifications", () => {
  it("tells the requester when someone un-pledges", async () => {
    await attendAll();
    await clearInboxes();
    const id = await freshRequest(2);
    await tomas.client.rpc("pledge", { p_request_id: id, p_quantity: 2 });
    await tomas.client.rpc("unpledge", { p_request_id: id });

    expect(await inbox(rhea, "pledge_released")).toEqual([
      {
        kind: "pledge_released",
        event_id: eventId,
        read_at: null,
        payload: { card: "Notify Test Strike (Red)", quantity: 2, actor: "Tomas", reason: "unpledged" },
      },
    ]);
  });

  it("doesn't notify when un-pledging without a pledge", async () => {
    await clearInboxes();
    const id = await freshRequest(1);
    await tomas.client.rpc("unpledge", { p_request_id: id });
    expect(await inbox(rhea, "pledge_released")).toEqual([]);
  });

  it("tells every pledger when a request is cancelled", async () => {
    await clearInboxes();
    const id = await freshRequest(3);
    await tomas.client.rpc("pledge", { p_request_id: id, p_quantity: 2 });
    await uma.client.rpc("pledge", { p_request_id: id, p_quantity: 1 });
    await rhea.client.rpc("cancel_request", { p_request_id: id });

    expect((await inbox(tomas, "request_cancelled")).map((n) => [n.kind, n.payload])).toEqual([
      ["request_cancelled", { card: "Notify Test Strike (Red)", quantity: 2, actor: "Rhea", reason: "cancelled" }],
    ]);
    expect((await inbox(uma, "request_cancelled")).map((n) => (n.payload as { quantity: number }).quantity)).toEqual([1]);
    expect(await inbox(rhea, "request_cancelled")).toEqual([]);
  });

  it("leaving releases pledges and notifies requesters", async () => {
    await attendAll();
    await clearInboxes();
    const id = await freshRequest(2);
    await tomas.client.rpc("pledge", { p_request_id: id, p_quantity: 2 });
    await tomas.client.rpc("leave_event", { p_event_id: eventId });

    const [n] = await inbox(rhea, "pledge_released");
    expect(n.kind).toBe("pledge_released");
    expect(n.payload).toMatchObject({ actor: "Tomas", quantity: 2, reason: "left_event" });
    const { count } = await admin.from("pledges").select("*", { count: "exact", head: true }).eq("request_id", id);
    expect(count).toBe(0);
  });

  it("leaving without cancelling keeps the leaver's requests and their pledges", async () => {
    await attendAll();
    await clearInboxes();
    const id = await freshRequest(2);
    await tomas.client.rpc("pledge", { p_request_id: id, p_quantity: 1 });
    await rhea.client.rpc("leave_event", { p_event_id: eventId, p_cancel_requests: false });

    const { data: req } = await admin.from("requests").select("status").eq("id", id).single();
    expect(req!.status).toBe("active");
    expect(await inbox(tomas, "request_cancelled")).toEqual([]);
  });

  it("leaving with cancel_requests cancels them and notifies their pledgers", async () => {
    await attendAll();
    await clearInboxes();
    const id = await freshRequest(2);
    await tomas.client.rpc("pledge", { p_request_id: id, p_quantity: 1 });
    await rhea.client.rpc("leave_event", { p_event_id: eventId, p_cancel_requests: true });

    const { data: req } = await admin.from("requests").select("status").eq("id", id).single();
    expect(req!.status).toBe("cancelled");
    const [n] = await inbox(tomas, "request_cancelled");
    expect(n.kind).toBe("request_cancelled");
    expect(n.payload).toMatchObject({ actor: "Rhea", reason: "left_event", quantity: 1 });
  });

  it("is private: users only see their own notifications", async () => {
    const { data: visible } = await uma.client.from("notifications").select("user_id");
    expect(visible!.length).toBeGreaterThan(0);
    expect(visible!.every((n) => n.user_id === uma.id)).toBe(true);
    const { data: peek } = await uma.client.from("notifications").select("id").eq("user_id", tomas.id);
    expect(peek).toEqual([]);
  });

  it("can't be written directly, and only your own get marked read", async () => {
    const { error } = await uma.client
      .from("notifications")
      .insert({ user_id: tomas.id, kind: "pledge_released", payload: {} });
    expect(error?.code).toBe("42501");

    await uma.client.rpc("mark_notifications_read");
    expect((await inbox(tomas)).every((n) => n.read_at === null)).toBe(true);
    await tomas.client.rpc("mark_notifications_read");
    expect((await inbox(tomas)).every((n) => n.read_at !== null)).toBe(true);
  });
});

/** Cancels Rhea's active requests (quietly) and adds the given ones; returns ids in card order. */
async function freshRequests(items: { card_id: string; quantity: number }[]): Promise<string[]> {
  await admin.from("requests").update({ status: "cancelled" }).eq("event_id", eventId).eq("status", "active");
  const { data, error } = await rhea.client.rpc("add_requests", { p_event_id: eventId, p_items: items });
  if (error) throw error;
  return items.map((i) => data!.find((r) => r.card_id === i.card_id)!.id);
}

const setPref = (u: TestUser, kind: string, enabled: boolean) =>
  u.client.from("notification_preferences").upsert({ user_id: u.id, kind, enabled });

describe("new_requests notifications", () => {
  it("sends ONE notification per add to each other attendee, however many cards", async () => {
    await attendAll();
    await clearInboxes();
    await freshRequests([
      { card_id: CARD.id, quantity: 3 },
      { card_id: CARD2.id, quantity: 1 },
    ]);

    for (const u of [tomas, uma]) {
      const got = await inbox(u, "new_requests");
      expect(got).toHaveLength(1);
      expect(got[0].payload).toEqual({ actor: "Rhea", card: "Notify Test Strike (Red)", items: 2, copies: 4 });
    }
    expect(await inbox(rhea, "new_requests")).toEqual([]);
  });

  it("skips people who aren't attending", async () => {
    await attendAll();
    await uma.client.rpc("leave_event", { p_event_id: eventId });
    await clearInboxes();
    await freshRequests([{ card_id: CARD.id, quantity: 1 }]);
    expect(await inbox(tomas, "new_requests")).toHaveLength(1);
    expect(await inbox(uma, "new_requests")).toEqual([]);
  });
});

describe("requests_filled notifications", () => {
  it("fires once, when the last unfilled request becomes covered", async () => {
    await attendAll();
    await clearInboxes();
    const [red, blue] = await freshRequests([
      { card_id: CARD.id, quantity: 2 },
      { card_id: CARD2.id, quantity: 1 },
    ]);

    await tomas.client.rpc("pledge", { p_request_id: red, p_quantity: 2 });
    expect(await inbox(rhea, "requests_filled")).toEqual([]); // blue still open

    await uma.client.rpc("pledge", { p_request_id: blue, p_quantity: 1 });
    const got = await inbox(rhea, "requests_filled");
    expect(got).toHaveLength(1);
    expect(got[0].payload).toEqual({ requests: 2, copies: 3, actor: "Uma" });

    // Re-pledging the same amount keeps things covered: no duplicate.
    await tomas.client.rpc("pledge", { p_request_id: red, p_quantity: 2 });
    expect(await inbox(rhea, "requests_filled")).toHaveLength(1);
  });

  it("fires exactly once when two people cover the last two requests at the same moment", async () => {
    await attendAll();
    for (let round = 0; round < 5; round++) {
      await clearInboxes();
      const [red, blue] = await freshRequests([
        { card_id: CARD.id, quantity: 1 },
        { card_id: CARD2.id, quantity: 1 },
      ]);
      const results = await Promise.all([
        tomas.client.rpc("pledge", { p_request_id: red, p_quantity: 1 }),
        uma.client.rpc("pledge", { p_request_id: blue, p_quantity: 1 }),
      ]);
      expect(results.map((r) => r.error)).toEqual([null, null]);
      expect(await inbox(rhea, "requests_filled")).toHaveLength(1);
    }
  });
});

describe("notification preferences", () => {
  afterAll(async () => {
    await admin.from("notification_preferences").delete().in("user_id", [rhea.id, tomas.id, uma.id]);
  });

  it("turning a kind off means it isn't stored at all; turning it back on resumes", async () => {
    await attendAll();
    expect((await setPref(tomas, "new_requests", false)).error).toBeNull();
    await clearInboxes();
    await freshRequests([{ card_id: CARD.id, quantity: 1 }]);
    expect(await inbox(tomas, "new_requests")).toEqual([]);
    expect(await inbox(uma, "new_requests")).toHaveLength(1); // others unaffected

    await setPref(tomas, "new_requests", true);
    await freshRequests([{ card_id: CARD.id, quantity: 1 }]);
    expect(await inbox(tomas, "new_requests")).toHaveLength(1);
  });

  it("applies to requests_filled too", async () => {
    await attendAll();
    await setPref(rhea, "requests_filled", false);
    await clearInboxes();
    const [red] = await freshRequests([{ card_id: CARD.id, quantity: 1 }]);
    await tomas.client.rpc("pledge", { p_request_id: red, p_quantity: 1 });
    expect(await inbox(rhea, "requests_filled")).toEqual([]);
  });

  it("is private and per-user", async () => {
    const { error } = await uma.client
      .from("notification_preferences")
      .insert({ user_id: tomas.id, kind: "pledge_released", enabled: false });
    expect(error?.code).toBe("42501");
    const { data } = await uma.client.from("notification_preferences").select("user_id");
    expect(data!.every((p) => p.user_id === uma.id)).toBe(true);
  });

  it("rejects unknown kinds", async () => {
    const { error } = await setPref(uma, "spam", false);
    expect(error?.code).toBe("23514");
  });
});

describe("realtime broadcasts", () => {
  const channels: RealtimeChannel[] = [];
  afterAll(async () => {
    await Promise.all(channels.map((c) => c.unsubscribe()));
  });

  /** Subscribes to a private topic; resolves once subscribed with a getter for received events. */
  async function listen(u: TestUser, topic: string, event: string) {
    await u.client.realtime.setAuth();
    const received: unknown[] = [];
    const channel = u.client
      .channel(topic, { config: { private: true } })
      .on("broadcast", { event }, (msg) => received.push(msg.payload));
    channels.push(channel);
    const status = await new Promise<string>((resolve) => {
      channel.subscribe((s) => {
        if (s !== "CLOSED") resolve(s);
      });
      setTimeout(() => resolve("TIMED_OUT"), 8000);
    });
    return { status, received };
  }

  // Realtime is at-most-once with variable latency under load; allow a generous ceiling.
  const waitFor = async (cond: () => boolean, ms = 10_000) => {
    const start = Date.now();
    while (!cond() && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 100));
    return cond();
  };

  it("pushes event changes (including deletes) to subscribers of that event", async () => {
    await attendAll();
    const sub = await listen(uma, `event:${eventId}`, "change");
    expect(sub.status).toBe("SUBSCRIBED");

    const id = await freshRequest(1);
    expect(await waitFor(() => sub.received.some((p) => (p as { table: string }).table === "requests"))).toBe(true);

    await tomas.client.rpc("pledge", { p_request_id: id, p_quantity: 1 });
    await tomas.client.rpc("unpledge", { p_request_id: id });
    expect(
      await waitFor(() => sub.received.some((p) => (p as { table: string; op: string }).op === "DELETE")),
    ).toBe(true);
  });

  it("pushes a ping to the notified user's private topic", async () => {
    await attendAll();
    const sub = await listen(rhea, `user:${rhea.id}`, "notification");
    expect(sub.status).toBe("SUBSCRIBED");
    const id = await freshRequest(1);
    await tomas.client.rpc("pledge", { p_request_id: id, p_quantity: 1 });
    await tomas.client.rpc("unpledge", { p_request_id: id });
    expect(await waitFor(() => sub.received.length > 0)).toBe(true);
  });

  it("doesn't deliver someone else's notification pings", async () => {
    await attendAll();
    const snoop = await listen(uma, `user:${rhea.id}`, "notification");
    const id = await freshRequest(1);
    await tomas.client.rpc("pledge", { p_request_id: id, p_quantity: 1 });
    await tomas.client.rpc("unpledge", { p_request_id: id });
    await new Promise((r) => setTimeout(r, 2000));
    expect(snoop.received).toEqual([]);
  });
});
