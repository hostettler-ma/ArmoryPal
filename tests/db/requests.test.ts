import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

const CARDS = [
  { id: "test-rq-red", name: "Request Test Strike", pitch: 1, color: "Red", types: ["Generic"] },
  { id: "test-rq-yellow", name: "Request Test Strike", pitch: 2, color: "Yellow", types: ["Generic"] },
  { id: "test-rq-blue", name: "Request Test Strike", pitch: 3, color: "Blue", types: ["Generic"] },
];

let requester: TestUser; // attending, asks for cards
let b1: TestUser; // attending, brings cards
let b2: TestUser; // attending, brings cards
let outsider: TestUser; // not attending
let storeId: string;
let eventId: string;
let pastEventId: string;
let pastRequestId: string;

beforeAll(async () => {
  await admin.from("cards").upsert(CARDS);
  [requester, b1, b2, outsider] = await Promise.all([
    createTestUser({ name: "Requester" }),
    createTestUser({ name: "Bringer One" }),
    createTestUser({ name: "Bringer Two" }),
    createTestUser({ name: "Outsider" }),
  ]);

  const { data: store } = await admin
    .from("stores")
    .insert({ name: "Request Test Store", city: "Testville", country: "Testland", timezone: "UTC" })
    .select()
    .single();
  storeId = store!.id;
  const { data: sched } = await admin
    .from("store_schedules")
    .insert({ store_id: storeId, weekday: 3, start_time: "18:00" })
    .select()
    .single();

  const { data: events } = await requester.client.rpc("current_events_for_stores", { p_store_ids: [storeId] });
  eventId = events![0].id;
  for (const u of [requester, b1, b2]) await u.client.rpc("attend_event", { p_event_id: eventId });

  // An ended event with attendees and an open request, set up directly.
  const { data: past } = await admin
    .from("events")
    .insert({
      schedule_id: sched!.id,
      store_id: storeId,
      event_date: "2026-01-07",
      starts_at: "2026-01-07T18:00:00Z",
      ends_at: "2026-01-08T00:00:00Z",
    })
    .select()
    .single();
  pastEventId = past!.id;
  await admin.from("attendances").insert([
    { event_id: pastEventId, user_id: requester.id },
    { event_id: pastEventId, user_id: b1.id },
  ]);
  const { data: pastReq } = await admin
    .from("requests")
    .insert({ event_id: pastEventId, requester_id: requester.id, card_id: "test-rq-red", quantity: 2 })
    .select()
    .single();
  pastRequestId = pastReq!.id;
});

afterAll(async () => {
  await admin.from("events").delete().eq("store_id", storeId); // cascades to requests/pledges/attendances
  await admin.from("stores").delete().eq("id", storeId);
  await admin.from("cards").delete().in("id", CARDS.map((c) => c.id));
  await deleteTestUsers();
});

const addRequests = (u: TestUser, items: { card_id: string; quantity: number }[], note?: string, event = eventId) =>
  u.client.rpc("add_requests", { p_event_id: event, p_items: items, p_note: note });

/** Creates a fresh request for `qty` copies of a card and returns its id. */
async function freshRequest(qty: number, card = "test-rq-blue"): Promise<string> {
  // Cancel any active request for this card first so add_requests doesn't merge into it.
  const { data: existing } = await admin
    .from("requests")
    .select("id")
    .eq("event_id", eventId)
    .eq("requester_id", requester.id)
    .eq("card_id", card)
    .eq("status", "active");
  for (const r of existing ?? []) await requester.client.rpc("cancel_request", { p_request_id: r.id });
  const { data, error } = await addRequests(requester, [{ card_id: card, quantity: qty }]);
  if (error) throw error;
  return data![0].id;
}

const pledged = async (requestId: string) => {
  const { data } = await admin.from("pledges").select("pledger_id, quantity").eq("request_id", requestId);
  return data ?? [];
};

describe("add_requests", () => {
  it("lets an attendee request several colors at once", async () => {
    const { data, error } = await addRequests(
      requester,
      [
        { card_id: "test-rq-red", quantity: 2 },
        { card_id: "test-rq-yellow", quantity: 1 },
      ],
      "  any printing  ",
    );
    expect(error).toBeNull();
    expect(data!.map((r) => [r.card_id, r.quantity, r.note])).toEqual([
      ["test-rq-red", 2, "any printing"],
      ["test-rq-yellow", 1, "any printing"],
    ]);
  });

  it("adds to an existing active request for the same card, capped at 20", async () => {
    const { data } = await addRequests(requester, [{ card_id: "test-rq-red", quantity: 1 }]);
    expect(data![0].quantity).toBe(3);
    const { data: capped } = await addRequests(requester, [{ card_id: "test-rq-red", quantity: 20 }]);
    expect(capped![0].quantity).toBe(20);
    const { count } = await admin
      .from("requests")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("card_id", "test-rq-red")
      .eq("status", "active");
    expect(count).toBe(1);
  });

  it("rejects non-attendees", async () => {
    const { error } = await addRequests(outsider, [{ card_id: "test-rq-red", quantity: 1 }]);
    expect(error?.message).toBe("not_attending");
  });

  it.each([
    ["no items", [], "no_items"],
    ["zero quantity", [{ card_id: "test-rq-red", quantity: 0 }], "invalid_quantity"],
    ["too many", [{ card_id: "test-rq-red", quantity: 21 }], "invalid_quantity"],
    ["unknown card", [{ card_id: "nope", quantity: 1 }], "card_not_found"],
  ])("rejects %s", async (_label, items, code) => {
    const { error } = await addRequests(requester, items as { card_id: string; quantity: number }[]);
    expect(error?.message).toBe(code);
  });

  it("is all-or-nothing when one item is invalid", async () => {
    const before = await admin.from("requests").select("id").eq("event_id", eventId);
    const { error } = await addRequests(requester, [
      { card_id: "test-rq-blue", quantity: 1 },
      { card_id: "nope", quantity: 1 },
    ]);
    expect(error?.message).toBe("card_not_found");
    const after = await admin.from("requests").select("id").eq("event_id", eventId);
    expect(after.data!.length).toBe(before.data!.length);
  });

  it("rejects a note over 200 characters", async () => {
    const { error } = await addRequests(requester, [{ card_id: "test-rq-blue", quantity: 1 }], "x".repeat(201));
    expect(error?.message).toBe("note_too_long");
  });
});

describe("pledge", () => {
  it("rejects pledging on your own request", async () => {
    const id = await freshRequest(3);
    const { error } = await requester.client.rpc("pledge", { p_request_id: id, p_quantity: 1 });
    expect(error?.message).toBe("own_request");
  });

  it("rejects non-attendees", async () => {
    const id = await freshRequest(3);
    const { error } = await outsider.client.rpc("pledge", { p_request_id: id, p_quantity: 1 });
    expect(error?.message).toBe("not_attending");
  });

  it("allows partial pledges from several people, never exceeding the quantity", async () => {
    const id = await freshRequest(3);
    expect((await b1.client.rpc("pledge", { p_request_id: id, p_quantity: 2 })).error).toBeNull();

    const tooMany = await b2.client.rpc("pledge", { p_request_id: id, p_quantity: 2 });
    expect(tooMany.error?.message).toBe("exceeds_remaining");

    expect((await b2.client.rpc("pledge", { p_request_id: id, p_quantity: 1 })).error).toBeNull();
    expect((await pledged(id)).reduce((s, p) => s + p.quantity, 0)).toBe(3);
  });

  it("replaces (not adds to) your existing pledge", async () => {
    const id = await freshRequest(3);
    await b1.client.rpc("pledge", { p_request_id: id, p_quantity: 2 });
    await b2.client.rpc("pledge", { p_request_id: id, p_quantity: 1 });

    // b1 lowers to 1, then may go back up to 2 (3 minus b2's 1), but not 3
    expect((await b1.client.rpc("pledge", { p_request_id: id, p_quantity: 1 })).error).toBeNull();
    expect((await b1.client.rpc("pledge", { p_request_id: id, p_quantity: 3 })).error?.message).toBe("exceeds_remaining");
    expect((await b1.client.rpc("pledge", { p_request_id: id, p_quantity: 2 })).error).toBeNull();

    const rows = await pledged(id);
    expect(rows.find((p) => p.pledger_id === b1.id)?.quantity).toBe(2);
    expect(rows).toHaveLength(2);
  });

  it.each([0, -1])("rejects quantity %i", async (q) => {
    const id = await freshRequest(3);
    const { error } = await b1.client.rpc("pledge", { p_request_id: id, p_quantity: q });
    expect(error?.message).toBe("invalid_quantity");
  });

  it("never over-pledges when two people pledge at the same moment", async () => {
    for (let round = 0; round < 5; round++) {
      const id = await freshRequest(2);
      const results = await Promise.all([
        b1.client.rpc("pledge", { p_request_id: id, p_quantity: 2 }),
        b2.client.rpc("pledge", { p_request_id: id, p_quantity: 2 }),
      ]);
      const succeeded = results.filter((r) => !r.error);
      expect(succeeded).toHaveLength(1);
      expect(results.find((r) => r.error)?.error?.message).toBe("exceeds_remaining");
      expect((await pledged(id)).reduce((s, p) => s + p.quantity, 0)).toBe(2);
    }
  });
});

describe("unpledge", () => {
  it("removes only your own pledge", async () => {
    const id = await freshRequest(3);
    await b1.client.rpc("pledge", { p_request_id: id, p_quantity: 1 });
    await b2.client.rpc("pledge", { p_request_id: id, p_quantity: 1 });
    expect((await b1.client.rpc("unpledge", { p_request_id: id })).error).toBeNull();
    expect((await pledged(id)).map((p) => p.pledger_id)).toEqual([b2.id]);
  });
});

describe("update_request / cancel_request", () => {
  it("lets the requester change quantity, but not below what's pledged", async () => {
    const id = await freshRequest(3);
    await b1.client.rpc("pledge", { p_request_id: id, p_quantity: 2 });

    const below = await requester.client.rpc("update_request", { p_request_id: id, p_quantity: 1 });
    expect(below.error?.message).toBe("below_pledged");

    const ok = await requester.client.rpc("update_request", { p_request_id: id, p_quantity: 2, p_note: "need by round 1" });
    expect(ok.error).toBeNull();
    expect(ok.data!.quantity).toBe(2);
    expect(ok.data!.note).toBe("need by round 1");
  });

  it("doesn't let others edit or cancel your request", async () => {
    const id = await freshRequest(2);
    expect((await b1.client.rpc("update_request", { p_request_id: id, p_quantity: 5 })).error?.message).toBe("not_owner");
    expect((await b1.client.rpc("cancel_request", { p_request_id: id })).error?.message).toBe("not_owner");
  });

  it("cancelling removes pledges and blocks new ones", async () => {
    const id = await freshRequest(2);
    await b1.client.rpc("pledge", { p_request_id: id, p_quantity: 1 });
    expect((await requester.client.rpc("cancel_request", { p_request_id: id })).error).toBeNull();

    const { data: req } = await admin.from("requests").select("status").eq("id", id).single();
    expect(req!.status).toBe("cancelled");
    expect(await pledged(id)).toEqual([]);
    expect((await b2.client.rpc("pledge", { p_request_id: id, p_quantity: 1 })).error?.message).toBe("request_cancelled");
    expect((await requester.client.rpc("cancel_request", { p_request_id: id })).error?.message).toBe("request_cancelled");
  });
});

describe("leave_event", () => {
  it("releases the leaver's pledges so the cards are needed again, leaving others' pledges alone", async () => {
    const id = await freshRequest(3);
    await b1.client.rpc("pledge", { p_request_id: id, p_quantity: 2 });
    await b2.client.rpc("pledge", { p_request_id: id, p_quantity: 1 });

    expect((await b1.client.rpc("leave_event", { p_event_id: eventId })).error).toBeNull();
    expect((await pledged(id)).map((p) => [p.pledger_id, p.quantity])).toEqual([[b2.id, 1]]);

    // b1 can come back, but must pledge again
    await b1.client.rpc("attend_event", { p_event_id: eventId });
    expect((await b1.client.rpc("pledge", { p_request_id: id, p_quantity: 2 })).error).toBeNull();
  });

  it("keeps the leaver's own requests (for now)", async () => {
    const id = await freshRequest(1, "test-rq-yellow");
    await requester.client.rpc("leave_event", { p_event_id: eventId });
    const { data } = await admin.from("requests").select("status").eq("id", id).single();
    expect(data!.status).toBe("active");
    await requester.client.rpc("attend_event", { p_event_id: eventId });
  });
});

describe("ended events are read-only", () => {
  it("rejects every write", async () => {
    const errors = await Promise.all([
      addRequests(requester, [{ card_id: "test-rq-blue", quantity: 1 }], undefined, pastEventId),
      b1.client.rpc("pledge", { p_request_id: pastRequestId, p_quantity: 1 }),
      b1.client.rpc("unpledge", { p_request_id: pastRequestId }),
      requester.client.rpc("update_request", { p_request_id: pastRequestId, p_quantity: 1 }),
      requester.client.rpc("cancel_request", { p_request_id: pastRequestId }),
    ]);
    expect(errors.map((r) => r.error?.message)).toEqual(Array(5).fill("event_ended"));
  });
});

describe("direct table access", () => {
  it("blocks inserts and updates that bypass the RPCs", async () => {
    const id = await freshRequest(2);
    const ins = await b1.client.from("pledges").insert({ request_id: id, event_id: eventId, pledger_id: b1.id, quantity: 2 });
    expect(ins.error?.code).toBe("42501");
    const req = await requester.client
      .from("requests")
      .insert({ event_id: eventId, requester_id: requester.id, card_id: "test-rq-red", quantity: 1 });
    expect(req.error?.code).toBe("42501");
    const { data: upd } = await requester.client.from("requests").update({ quantity: 9 }).eq("id", id).select();
    expect(upd).toEqual([]);
  });

  it("refuses anonymous callers", async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false },
    });
    const { error } = await anon.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "test-rq-red", quantity: 1 }] });
    expect(error).not.toBeNull();
  });
});
