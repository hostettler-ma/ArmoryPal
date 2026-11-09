import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

const CARDS = ["a", "b", "c", "d", "t"].map((k, i) => ({
  id: `test-ro-${k}`,
  name: `Rollover Test ${k.toUpperCase()}`,
  pitch: (i % 3) + 1,
  color: ["Red", "Yellow", "Blue"][i % 3],
  types: ["Generic"],
}));
const card = (k: string) => `test-ro-${k}`;

let rhea: TestUser;
let tomas: TestUser;
let storeId: string;
let scheduleId: string;
let currentId: string;
let lastWeekId: string;
let otherSlotPastId: string;

const minusDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

/** Unwraps a Supabase response, failing setup loudly with the real error. */
function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error || res.data === null) throw new Error(`${what}: ${res.error?.message ?? "no data"}`);
  return res.data;
}

beforeAll(async () => {
  must(await admin.from("cards").upsert(CARDS).select(), "cards");
  [rhea, tomas] = await Promise.all([createTestUser({ name: "Rhea" }), createTestUser({ name: "Tomas" })]);

  const { data: store } = await admin
    .from("stores")
    .insert({ name: "Rollover Test Store", city: "Testville", country: "Testland", timezone: "UTC" })
    .select()
    .single();
  storeId = store!.id;
  const { data: scheds } = await admin
    .from("store_schedules")
    .insert([
      { store_id: storeId, weekday: 2, start_time: "18:00", label: "Armory", active: true },
      { store_id: storeId, weekday: 5, start_time: "18:00", label: "Friday", active: true },
    ])
    .select();
  scheduleId = scheds!.find((s) => s.weekday === 2)!.id;
  const otherScheduleId = scheds!.find((s) => s.weekday === 5)!.id;

  const events = must(await rhea.client.rpc("current_events_for_stores", { p_store_ids: [storeId] }), "events");
  const current = events.find((e) => e.schedule_id === scheduleId)!;
  currentId = current.id;

  const lastWeekDate = minusDays(current.event_date, 7);
  const pastRes = await admin
    .from("events")
    .insert([
      {
        schedule_id: scheduleId,
        label: "Armory",
        store_id: storeId,
        event_date: lastWeekDate,
        starts_at: `${lastWeekDate}T18:00:00Z`,
        ends_at: `${minusDays(current.event_date, 6)}T00:00:00Z`,
      },
      {
        schedule_id: otherScheduleId,
        label: "Armory",
        store_id: storeId,
        // The Friday 11 days before this Tuesday: always in the past, never the
        // Friday slot's own current event.
        event_date: minusDays(current.event_date, 11),
        starts_at: `${minusDays(current.event_date, 11)}T18:00:00Z`,
        ends_at: `${minusDays(current.event_date, 10)}T00:00:00Z`,
      },
    ])
    .select();
  const past = must(pastRes, "past events");
  lastWeekId = past.find((e) => e.schedule_id === scheduleId)!.id;
  otherSlotPastId = past.find((e) => e.schedule_id === otherScheduleId)!.id;

  // Last week, as left behind after the event:
  //   a: needed 3, Tomas pledged 1   → 2 still needed
  //   b: needed 1, Tomas pledged 1   → covered, not copied
  //   c: needed 2, no pledges        → 2 still needed
  //   d: cancelled                   → not copied
  //   t: Tomas's own request         → not Rhea's to copy
  const reqsRes = await admin
    .from("requests")
    .insert([
      { event_id: lastWeekId, requester_id: rhea.id, card_id: card("a"), quantity: 3, note: "any printing", status: "active" },
      { event_id: lastWeekId, requester_id: rhea.id, card_id: card("b"), quantity: 1, note: null, status: "active" },
      { event_id: lastWeekId, requester_id: rhea.id, card_id: card("c"), quantity: 2, note: null, status: "active" },
      { event_id: lastWeekId, requester_id: rhea.id, card_id: card("d"), quantity: 1, note: null, status: "cancelled" },
      { event_id: lastWeekId, requester_id: tomas.id, card_id: card("t"), quantity: 1, note: null, status: "active" },
    ])
    .select();
  const reqs = must(reqsRes, "requests");
  const id = (k: string) => reqs.find((r) => r.card_id === card(k) && r.requester_id === rhea.id)!.id;
  await admin.from("pledges").insert([
    { request_id: id("a"), event_id: lastWeekId, pledger_id: tomas.id, quantity: 1 },
    { request_id: id("b"), event_id: lastWeekId, pledger_id: tomas.id, quantity: 1 },
  ]);
});

afterAll(async () => {
  await admin.from("events").delete().eq("store_id", storeId);
  await admin.from("stores").delete().eq("id", storeId);
  await admin.from("cards").delete().in("id", CARDS.map((c) => c.id));
  await deleteTestUsers();
});

const copy = (u: TestUser, from = lastWeekId, to = currentId) =>
  u.client.rpc("copy_open_requests", { p_from_event: from, p_to_event: to });

const thisWeek = async () => {
  const { data } = await admin
    .from("requests")
    .select("card_id, quantity, note, copied_from_id, requester_id")
    .eq("event_id", currentId)
    .eq("status", "active")
    .order("card_id");
  return data ?? [];
};

describe("copy_open_requests", () => {
  it("requires attending this week's event", async () => {
    const { error } = await copy(rhea);
    expect(error?.message).toBe("not_attending");
  });

  it("copies only the still-needed quantity of unfilled requests, merging with this week's", async () => {
    await rhea.client.rpc("attend_event", { p_event_id: currentId });
    await tomas.client.rpc("attend_event", { p_event_id: currentId });
    // Rhea already asked for 1× c this week; the copy should add to it.
    await rhea.client.rpc("add_requests", { p_event_id: currentId, p_items: [{ card_id: card("c"), quantity: 1 }] });
    await admin.from("notifications").delete().in("user_id", [rhea.id, tomas.id]);

    const { data: copied, error } = await copy(rhea);
    expect(error).toBeNull();
    expect(copied).toBe(2);

    const rows = await thisWeek();
    expect(rows.map((r) => [r.card_id, r.quantity, r.note])).toEqual([
      [card("a"), 2, "any printing"],
      [card("c"), 3, null],
    ]);
    expect(rows.every((r) => r.copied_from_id !== null)).toBe(true);
    expect(rows.every((r) => r.requester_id === rhea.id)).toBe(true);
  });

  it("tells other attendees once", async () => {
    const { data } = await tomas.client.from("notifications").select("kind, payload").eq("kind", "new_requests");
    expect(data).toHaveLength(1);
    expect(data![0].payload).toEqual({ actor: "Rhea", card: "Rollover Test A (Red)", items: 2, copies: 4 });
  });

  it("is idempotent: copying again does nothing", async () => {
    const { data: again } = await copy(rhea);
    expect(again).toBe(0);
    expect((await thisWeek()).map((r) => r.quantity)).toEqual([2, 3]);
  });

  it("rejects copying from an event that hasn't ended, another slot, or into an ended event", async () => {
    expect((await copy(rhea, currentId, currentId)).error?.message).toBe("invalid_copy");
    expect((await copy(rhea, otherSlotPastId)).error?.message).toBe("invalid_copy");
    expect((await copy(rhea, currentId, lastWeekId)).error?.message).toBe("event_ended");
  });

  it("rejects unknown events", async () => {
    const { error } = await copy(rhea, "00000000-0000-4000-a000-0000000000ff");
    expect(error?.message).toBe("event_not_found");
  });
});
