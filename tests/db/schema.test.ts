import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

// Schema-level guarantees (*_schema_cleanup.sql): checks that hold even for
// writes that bypass the RPCs (service role, future functions).

const CARDS = [{ id: "test-schema-card", name: "Schema Test Strike", pitch: 1, color: "Red", types: ["Generic"] }];

let alice: TestUser;
let bob: TestUser;
let storeA: string;
let storeB: string;
let scheduleA: string;
let eventA: string;
let eventB: string;

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function insertEvent(storeId: string, scheduleId: string | null, date: string) {
  return admin.from("events").insert({
    store_id: storeId,
    schedule_id: scheduleId,
    event_date: date,
    starts_at: `${date}T18:00:00Z`,
    ends_at: `${date}T23:59:00Z`,
    label: "Schema Armory",
  });
}

beforeAll(async () => {
  await admin.from("cards").upsert(CARDS);
  [alice, bob] = await Promise.all([createTestUser({ name: "Schema Alice" }), createTestUser({ name: "Schema Bob" })]);
  const { data: stores } = await admin
    .from("stores")
    .insert([
      { name: "Schema Store A", city: "Schemaville", country: "Testland", timezone: "UTC" },
      { name: "Schema Store B", city: "Schemaville", country: "Testland", timezone: "UTC" },
    ])
    .select("id, name")
    .order("name");
  [storeA, storeB] = stores!.map((s) => s.id);
  const { data: sched } = await admin
    .from("store_schedules")
    .insert({ store_id: storeA, weekday: 1, start_time: "18:00", label: "Armory" })
    .select("id")
    .single();
  scheduleA = sched!.id;
  const { data: events } = await admin
    .from("events")
    .insert([
      { store_id: storeA, event_date: day(2), starts_at: `${day(2)}T18:00:00Z`, ends_at: `${day(2)}T23:59:00Z`, label: "A" },
      { store_id: storeB, event_date: day(2), starts_at: `${day(2)}T18:00:00Z`, ends_at: `${day(2)}T23:59:00Z`, label: "B" },
    ])
    .select("id, label")
    .order("label");
  [eventA, eventB] = events!.map((e) => e.id);
});

afterAll(async () => {
  await admin.from("events").delete().in("store_id", [storeA, storeB]);
  await admin.from("stores").delete().in("id", [storeA, storeB]);
  await deleteTestUsers();
});

describe("integrity", () => {
  it("keeps a pledge's event the same as its request's", async () => {
    const { data: req } = await admin
      .from("requests")
      .insert({ event_id: eventA, requester_id: alice.id, card_id: "test-schema-card", quantity: 1 })
      .select("id")
      .single();
    const wrong = await admin.from("pledges").insert({ request_id: req!.id, event_id: eventB, pledger_id: bob.id, quantity: 1 });
    expect(wrong.error?.code).toBe("23503");
    const right = await admin.from("pledges").insert({ request_id: req!.id, event_id: eventA, pledger_id: bob.id, quantity: 1 });
    expect(right.error).toBeNull();
  });

  it("keeps a weekly event at its schedule's store, and leaves one-offs alone", async () => {
    expect((await insertEvent(storeB, scheduleA, day(9))).error?.code).toBe("23503");
    expect((await insertEvent(storeA, scheduleA, day(9))).error).toBeNull();
    expect((await insertEvent(storeB, null, day(10))).error).toBeNull();
  });

  it("accepts only known notification kinds and admin actions", async () => {
    const bogus = await admin.from("notifications").insert({ user_id: alice.id, kind: "bogus", payload: {} });
    expect(bogus.error?.code).toBe("23514");
    const ok = await admin.from("notifications").insert({ user_id: alice.id, kind: "event_cancelled", payload: {} });
    expect(ok.error).toBeNull();

    const pref = await alice.client.from("notification_preferences").insert({ user_id: alice.id, kind: "bogus", enabled: false });
    expect(pref.error?.code).toBe("23514");
    const goodPref = await alice.client
      .from("notification_preferences")
      .insert({ user_id: alice.id, kind: "new_requests", enabled: false });
    expect(goodPref.error).toBeNull();

    const action = await admin.from("admin_actions").insert({ action: "bogus" });
    expect(action.error?.code).toBe("23514");
  });
});

describe("pruning notifications", () => {
  it("drops read ones after 90 days and any after a year", async () => {
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = [
      { label: "recent read", created_at: ago(10), read_at: ago(9), kept: true },
      { label: "old unread", created_at: ago(100), read_at: null, kept: true },
      { label: "old read", created_at: ago(100), read_at: ago(99), kept: false },
      { label: "ancient unread", created_at: ago(400), read_at: null, kept: false },
    ];
    const { data, error } = await admin
      .from("notifications")
      .insert(rows.map((r) => ({ user_id: bob.id, kind: "new_requests", payload: { card: r.label }, created_at: r.created_at, read_at: r.read_at })))
      .select("id, payload");
    expect(error).toBeNull();

    const pruned = await admin.rpc("prune_notifications");
    expect(pruned.error).toBeNull();
    expect(pruned.data).toBeGreaterThanOrEqual(2);

    const { data: left } = await admin.from("notifications").select("id").in("id", data!.map((d) => d.id));
    const leftIds = new Set(left!.map((l) => l.id));
    for (const r of rows) {
      const id = data!.find((d) => (d.payload as { card: string }).card === r.label)!.id;
      expect(leftIds.has(id), r.label).toBe(r.kept);
    }
  });

  it("isn't callable by players", async () => {
    expect((await alice.client.rpc("prune_notifications")).error).not.toBeNull();
  });
});
