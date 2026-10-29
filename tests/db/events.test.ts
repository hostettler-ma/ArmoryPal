import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentEventFor } from "../../src/lib/events";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

let alice: TestUser;
let bob: TestUser;
let storeId: string;
let scheduleId: string;
let inactiveScheduleId: string;

beforeAll(async () => {
  [alice, bob] = await Promise.all([createTestUser({ name: "Alice" }), createTestUser({ name: "Bob" })]);
  const { data: store } = await admin
    .from("stores")
    .insert({ name: "Event Test Store", city: "Testville", country: "Testland", timezone: "America/Chicago" })
    .select()
    .single();
  storeId = store!.id;
  const { data: schedules } = await admin
    .from("store_schedules")
    .insert([
      // Bulk inserts send missing keys as NULL, so give every row the same keys.
      { store_id: storeId, weekday: 2, start_time: "18:30", label: "Armory", active: true },
      { store_id: storeId, weekday: 6, start_time: "13:00", label: "Saturday", active: true },
      { store_id: storeId, weekday: 4, start_time: "19:00", label: "Armory", active: false },
    ])
    .select();
  scheduleId = schedules!.find((s) => s.weekday === 2)!.id;
  inactiveScheduleId = schedules!.find((s) => !s.active)!.id;
});

afterAll(async () => {
  await admin.from("events").delete().eq("store_id", storeId);
  await admin.from("stores").delete().eq("id", storeId);
  await deleteTestUsers();
});

describe("event_occurrence (SQL) matches currentEventFor (TS)", () => {
  const cases: [number, string, string, string][] = [
    [2, "18:30", "America/Chicago", "2026-11-02T16:00:00Z"],
    [2, "18:30", "America/Chicago", "2026-11-04T05:59:00Z"], // last minute of event day
    [2, "18:30", "America/Chicago", "2026-11-04T06:00:00Z"], // rollover
    [2, "18:30", "America/Chicago", "2026-10-28T12:00:00Z"], // week after US DST change
    [0, "13:00", "Europe/London", "2026-03-28T12:00:00Z"], // EU DST day
    [2, "18:30", "Australia/Melbourne", "2026-11-03T20:00:00Z"],
    [2, "18:30", "America/Los_Angeles", "2026-11-03T20:00:00Z"],
    [6, "13:00", "Europe/London", "2026-12-30T12:00:00Z"], // year boundary
    [5, "18:30", "Asia/Kolkata", "2026-06-12T13:00:00Z"], // half-hour offset
  ];

  it.each(cases)("weekday %i %s in %s at %s", async (weekday, time, tz, now) => {
    const { data, error } = await alice.client
      .rpc("event_occurrence", { p_weekday: weekday, p_start_time: time, p_timezone: tz, p_now: now })
      .single();
    expect(error).toBeNull();
    const ts = currentEventFor({ weekday, start_time: time }, tz, new Date(now));
    expect(data!.event_date).toBe(ts.eventDate);
    expect(new Date(data!.starts_at).toISOString()).toBe(ts.startsAt.toISOString());
    expect(new Date(data!.ends_at).toISOString()).toBe(ts.endsAt.toISOString());
  });
});

describe("current_events_for_stores", () => {
  it("lazily creates one event per active schedule and is idempotent", async () => {
    const first = await alice.client.rpc("current_events_for_stores", { p_store_ids: [storeId] });
    expect(first.error).toBeNull();
    expect(first.data).toHaveLength(2);
    expect(first.data!.map((e) => e.schedule_id)).not.toContain(inactiveScheduleId);

    const second = await bob.client.rpc("current_events_for_stores", { p_store_ids: [storeId] });
    expect(second.data!.map((e) => e.id).sort()).toEqual(first.data!.map((e) => e.id).sort());

    const { count } = await admin.from("events").select("*", { count: "exact", head: true }).eq("store_id", storeId);
    expect(count).toBe(2);
  });

  it("refuses anonymous callers", async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false },
    });
    const { error } = await anon.rpc("current_events_for_stores", { p_store_ids: [storeId] });
    expect(error).not.toBeNull();
  });

  it("blocks users from creating events directly", async () => {
    const { error } = await alice.client.from("events").insert({
      schedule_id: scheduleId,
      store_id: storeId,
      event_date: "2030-01-01",
      starts_at: "2030-01-01T18:00:00Z",
      ends_at: "2030-01-02T06:00:00Z",
    });
    expect(error?.code).toBe("42501");
  });
});

describe("attendance", () => {
  let eventId: string;
  let pastEventId: string;

  beforeAll(async () => {
    const { data } = await alice.client.rpc("current_events_for_stores", { p_store_ids: [storeId] });
    eventId = data!.find((e) => e.schedule_id === scheduleId)!.id;
    const { data: past } = await admin
      .from("events")
      .insert({
        schedule_id: scheduleId,
        store_id: storeId,
        event_date: "2026-01-06",
        starts_at: "2026-01-07T00:30:00Z",
        ends_at: "2026-01-07T06:00:00Z",
      })
      .select()
      .single();
    pastEventId = past!.id;
  });

  it("lets a user attend (twice is harmless) and everyone see it", async () => {
    expect((await alice.client.rpc("attend_event", { p_event_id: eventId })).error).toBeNull();
    expect((await alice.client.rpc("attend_event", { p_event_id: eventId })).error).toBeNull();
    const { data } = await bob.client.from("attendances").select("user_id").eq("event_id", eventId);
    expect(data!.map((a) => a.user_id)).toEqual([alice.id]);
  });

  it("lets a user leave, removing only their own attendance", async () => {
    await bob.client.rpc("attend_event", { p_event_id: eventId });
    expect((await alice.client.rpc("leave_event", { p_event_id: eventId })).error).toBeNull();
    const { data } = await admin.from("attendances").select("user_id").eq("event_id", eventId);
    expect(data!.map((a) => a.user_id)).toEqual([bob.id]);
  });

  it("rejects attending or leaving an event that has ended", async () => {
    const attend = await alice.client.rpc("attend_event", { p_event_id: pastEventId });
    expect(attend.error?.message).toMatch(/ended/);

    await admin.from("attendances").insert({ event_id: pastEventId, user_id: alice.id });
    const leave = await alice.client.rpc("leave_event", { p_event_id: pastEventId });
    expect(leave.error?.message).toMatch(/ended/);
  });

  it("rejects unknown events", async () => {
    const { error } = await alice.client.rpc("attend_event", { p_event_id: "00000000-0000-4000-a000-0000000000ff" });
    expect(error?.message).toBe("event_not_found");
  });

  it("blocks direct writes to attendances, so users can't add or remove others", async () => {
    const { error } = await alice.client.from("attendances").insert({ event_id: eventId, user_id: alice.id });
    expect(error?.code).toBe("42501");
    const { data: removed } = await alice.client.from("attendances").delete().eq("event_id", eventId).select();
    expect(removed).toEqual([]);
  });

  it("doesn't expose the internal assert_event_open helper", async () => {
    // Cast: the helper is intentionally absent from the public API surface.
    const { error } = await (alice.client.rpc as (fn: string, args: object) => ReturnType<typeof alice.client.rpc>)(
      "assert_event_open",
      { p_event_id: eventId },
    );
    expect(error).not.toBeNull();
  });
});
