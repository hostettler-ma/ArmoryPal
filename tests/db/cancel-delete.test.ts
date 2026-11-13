import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

// Cancelling and deleting events (*_cancel_delete_events.sql).

const CARDS = [{ id: "test-cd-card", name: "Cancel Delete Test Strike", pitch: 1, color: "Red", types: ["Generic"] }];

let owner: TestUser;
let player: TestUser; // going
let helper: TestUser; // going, pledges
let follower: TestUser; // saved the store
let outsider: TestUser;
let storeId: string;
let scheduleId: string;
// Three days from today (UTC), so the slot's event is safely in the future.
const weekday = (new Date().getUTCDay() + 3) % 7;

const plusDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error || res.data === null) throw new Error(`${what}: ${res.error?.message ?? "no data"}`);
  return res.data;
}

const currentEvents = async () =>
  must(await player.client.rpc("current_events_for_stores", { p_store_ids: [storeId] }), "current events");
const weeklyEvent = async () => (await currentEvents()).find((e) => e.schedule_id === scheduleId)!;
const notificationsOf = async (u: TestUser, kind: string) =>
  must(await u.client.from("notifications").select("event_id, payload").eq("kind", kind), kind);

async function oneOff(label: string) {
  return must(
    await owner.client.rpc("owner_create_event", {
      p_store_id: storeId,
      p_label: label,
      p_date: plusDays(new Date().toISOString().slice(0, 10), 2),
      p_start_time: "12:00",
    }),
    "create",
  );
}

/** Player attends with a request; helper attends and pledges on it. */
async function fill(eventId: string) {
  await player.client.rpc("attend_event", { p_event_id: eventId });
  await helper.client.rpc("attend_event", { p_event_id: eventId });
  must(
    await player.client.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "test-cd-card", quantity: 2 }] }),
    "add",
  );
  const { data: req } = await admin.from("requests").select("id").eq("event_id", eventId).single();
  expect((await helper.client.rpc("pledge", { p_request_id: req!.id, p_quantity: 1 })).error).toBeNull();
}

beforeAll(async () => {
  await admin.from("cards").upsert(CARDS);
  [owner, player, helper, follower, outsider] = await Promise.all([
    createTestUser({ name: "CD Owner" }),
    createTestUser({ name: "CD Player" }),
    createTestUser({ name: "CD Helper" }),
    createTestUser({ name: "CD Follower" }),
    createTestUser({ name: "CD Outsider" }),
  ]);
  const { data: store } = await admin
    .from("stores")
    .insert({ name: "Cancel Delete Store", city: "Cancelville", country: "Testland", timezone: "UTC" })
    .select()
    .single();
  storeId = store!.id;
  await admin.from("store_owners").insert({ store_id: storeId, user_id: owner.id });
  await admin.from("user_stores").insert({ store_id: storeId, user_id: follower.id });
  const { data: sched } = await admin
    .from("store_schedules")
    .insert({ store_id: storeId, weekday, start_time: "18:00", label: "Armory" })
    .select()
    .single();
  scheduleId = sched!.id;
});

afterAll(async () => {
  await admin.from("events").delete().eq("store_id", storeId);
  await admin.from("stores").delete().eq("id", storeId);
  await deleteTestUsers();
});

describe("cancelling an event", () => {
  it("keeps it visible and read-only, and tells its audience", async () => {
    const id = await oneOff("Holiday Armory");
    await fill(id);

    expect((await outsider.client.rpc("owner_cancel_event", { p_event_id: id, p_note: "x" })).error?.message).toBe(
      "not_store_owner",
    );
    const tooLong = await owner.client.rpc("owner_cancel_event", { p_event_id: id, p_note: "x".repeat(141) });
    expect(tooLong.error?.message).toBe("cancel_note_too_long");

    expect(
      (await owner.client.rpc("owner_cancel_event", { p_event_id: id, p_note: "  Closed for Thanksgiving " })).error,
    ).toBeNull();

    // Still listed, with its players, requests and pledges.
    const listed = (await currentEvents()).find((e) => e.id === id)!;
    expect(listed.cancelled_at).not.toBeNull();
    expect(listed.cancel_note).toBe("Closed for Thanksgiving");
    const { count: going } = await admin.from("attendances").select("user_id", { count: "exact", head: true }).eq("event_id", id);
    expect(going).toBe(2);
    const { count: pledges } = await admin.from("pledges").select("request_id", { count: "exact", head: true }).eq("event_id", id);
    expect(pledges).toBe(1);

    // Players going and followers are told; the owner who cancelled isn't.
    for (const u of [player, helper, follower]) {
      const told = (await notificationsOf(u, "event_cancelled")).filter((n) => n.event_id === id);
      expect(told).toHaveLength(1);
      expect(told[0].payload).toMatchObject({
        label: "Holiday Armory",
        store: "Cancel Delete Store",
        note: "Closed for Thanksgiving",
      });
    }
    expect(await notificationsOf(owner, "event_cancelled")).toHaveLength(0);
    expect(await notificationsOf(outsider, "event_cancelled")).toHaveLength(0);

    // Read-only for players and owners alike; cancelling twice fails.
    expect((await outsider.client.rpc("attend_event", { p_event_id: id })).error?.message).toBe("event_cancelled");
    expect((await player.client.rpc("leave_event", { p_event_id: id, p_cancel_requests: true })).error?.message).toBe(
      "event_cancelled",
    );
    expect((await owner.client.rpc("owner_rename_event", { p_event_id: id, p_label: "New" })).error?.message).toBe(
      "event_cancelled",
    );
    expect((await owner.client.rpc("owner_cancel_event", { p_event_id: id })).error?.message).toBe("event_cancelled");
  });

  it("works without a message", async () => {
    const id = await oneOff("Quiet Armory");
    expect((await owner.client.rpc("owner_cancel_event", { p_event_id: id })).error).toBeNull();
    const told = (await notificationsOf(follower, "event_cancelled")).find((n) => n.event_id === id)!;
    expect(told.payload).not.toHaveProperty("note");
  });
});

describe("deleting an event", () => {
  it("deletes a one-off outright, silently", async () => {
    const id = await oneOff("Mistake");
    await fill(id);
    const notified = async () =>
      (await admin.from("notifications").select("id", { count: "exact", head: true }).in("user_id", [player.id, helper.id, follower.id]))
        .count!;
    const before = await notified();

    expect((await outsider.client.rpc("owner_delete_event", { p_event_id: id })).error?.message).toBe("not_store_owner");
    expect((await owner.client.rpc("owner_delete_event", { p_event_id: id })).error).toBeNull();

    const { data } = await admin.from("events").select("id").eq("id", id);
    expect(data).toEqual([]);
    const { count: requests } = await admin.from("requests").select("id", { count: "exact", head: true }).eq("event_id", id);
    expect(requests).toBe(0);
    // Nobody was notified (its new_requests notifications went with it).
    expect(await notified()).toBeLessThan(before);
  });

  it("hides a deleted weekly event for good and hands the slot to next week", async () => {
    const ev = await weeklyEvent();
    await fill(ev.id);
    expect((await owner.client.rpc("owner_delete_event", { p_event_id: ev.id })).error).toBeNull();

    // Invisible to players, and not recreated by lazy creation.
    const { data: direct } = await player.client.from("events").select("id").eq("id", ev.id);
    expect(direct).toEqual([]);
    const next = await weeklyEvent();
    expect(next.id).not.toBe(ev.id);
    expect(next.slot_date).toBe(plusDays(ev.slot_date!, 7));
    const { count } = await admin
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("schedule_id", scheduleId)
      .eq("slot_date", ev.slot_date!);
    expect(count).toBe(1);

    // Everything on it is gone, and nothing can be written to it.
    for (const table of ["attendances", "requests", "pledges", "notifications"] as const) {
      const { count: n } = await admin.from(table).select("*", { count: "exact", head: true }).eq("event_id", ev.id);
      expect(n, table).toBe(0);
    }
    expect((await player.client.rpc("attend_event", { p_event_id: ev.id })).error?.message).toBe("event_not_found");
    expect((await owner.client.rpc("owner_delete_event", { p_event_id: ev.id })).error?.message).toBe("event_not_found");

    // Owners don't see it among upcoming events either.
    const upcoming = must(await owner.client.rpc("owner_upcoming_events", { p_store_id: storeId, p_weeks: 3 }), "upcoming");
    expect(upcoming.map((e) => e.id)).not.toContain(ev.id);
    expect(upcoming.map((e) => e.slot_date)).not.toContain(ev.slot_date);
  });

  it("can delete a cancelled event, but not a past one", async () => {
    const id = await oneOff("Cancel then delete");
    await owner.client.rpc("owner_cancel_event", { p_event_id: id, p_note: "Oops" });
    expect((await owner.client.rpc("owner_delete_event", { p_event_id: id })).error).toBeNull();

    const past = await oneOff("Past");
    await admin
      .from("events")
      .update({ starts_at: new Date(Date.now() - 7_200_000).toISOString(), ends_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", past);
    expect((await owner.client.rpc("owner_delete_event", { p_event_id: past })).error?.message).toBe("event_ended");
    expect((await owner.client.rpc("owner_cancel_event", { p_event_id: past })).error?.message).toBe("event_ended");
  });
});
