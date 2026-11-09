import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentEventFor } from "../../src/lib/events";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

const CARDS = [{ id: "test-em-card", name: "Event Manage Test Strike", pitch: 1, color: "Red", types: ["Generic"] }];

let owner: TestUser;
let player: TestUser; // going
let follower: TestUser; // saved the store
let outsider: TestUser;
let storeId: string;
let otherStoreId: string;
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

const currentEvents = async (store = storeId) =>
  must(await player.client.rpc("current_events_for_stores", { p_store_ids: [store] }), "current events");
const weeklyEvent = async () => (await currentEvents()).find((e) => e.schedule_id === scheduleId)!;
const notificationsOf = async (u: TestUser, kind: string) =>
  must(await u.client.from("notifications").select("event_id, payload").eq("kind", kind), kind);

async function newStore(name: string) {
  const { data } = await admin
    .from("stores")
    .insert({ name, city: "Manageville", country: "Testland", timezone: "UTC" })
    .select()
    .single();
  return data!.id as string;
}

beforeAll(async () => {
  await admin.from("cards").upsert(CARDS);
  [owner, player, follower, outsider] = await Promise.all([
    createTestUser({ name: "Store Owner" }),
    createTestUser({ name: "EM Player" }),
    createTestUser({ name: "EM Follower" }),
    createTestUser({ name: "EM Outsider" }),
  ]);
  storeId = await newStore("Event Manage Store");
  otherStoreId = await newStore("Event Manage Other Store");
  await admin.from("store_owners").insert({ store_id: storeId, user_id: owner.id });
  await admin.from("user_stores").insert({ store_id: storeId, user_id: follower.id });
  const { data: sched } = await admin
    .from("store_schedules")
    .insert({ store_id: storeId, weekday, start_time: "18:00", label: "Armory" })
    .select()
    .single();
  scheduleId = sched!.id;
  await admin.from("store_schedules").insert({ store_id: otherStoreId, weekday, start_time: "18:00" });
});

afterAll(async () => {
  await admin.from("events").delete().in("store_id", [storeId, otherStoreId]);
  await admin.from("stores").delete().in("id", [storeId, otherStoreId]);
  await deleteTestUsers();
});

describe("event links", () => {
  it("lets only the store's owner set them, and checks them", async () => {
    const ev = await weeklyEvent();
    expect(ev.label).toBe("Armory");
    expect(ev.slot_date).toBe(ev.event_date);

    const links = { p_event_id: ev.id, p_gem_url: "", p_gem_code: "12345", p_ticket_url: "https://shop.example.com/t" };
    expect((await outsider.client.rpc("owner_update_event_links", links)).error?.message).toBe("not_store_owner");
    expect((await owner.client.rpc("owner_update_event_links", links)).error).toBeNull();

    const bad = await owner.client.rpc("owner_update_event_links", { ...links, p_ticket_url: "javascript:alert(1)" });
    expect(bad.error?.message).toBe("invalid_ticket_link");
    const badGem = await owner.client.rpc("owner_update_event_links", { ...links, p_gem_url: "https://evil.example.com/" });
    expect(badGem.error?.message).toBe("invalid_gem_link");

    const { data } = await admin.from("events").select("gem_code, ticket_url").eq("id", ev.id).single();
    expect(data).toEqual({ gem_code: "12345", ticket_url: "https://shop.example.com/t" });

    // Owners can't write events directly either.
    const direct = await owner.client.from("events").update({ ticket_url: "https://x.example.com" }).eq("id", ev.id).select();
    expect(direct.data ?? []).toEqual([]);
  });

  it("checks the store's default ticket link", async () => {
    const bad = await owner.client.rpc("owner_update_store_info", {
      p_store_id: storeId,
      p_notes: "Pre-register",
      p_ticket_url: "http://insecure.example.com",
    });
    expect(bad.error?.message).toBe("invalid_ticket_link");
    expect(
      (
        await owner.client.rpc("owner_update_store_info", {
          p_store_id: storeId,
          p_notes: "Pre-register",
          p_ticket_url: "https://shop.example.com",
        })
      ).error,
    ).toBeNull();
    const other = await owner.client.rpc("owner_update_store_info", {
      p_store_id: otherStoreId,
      p_notes: "",
      p_ticket_url: "",
    });
    expect(other.error?.message).toBe("not_store_owner");
  });
});

describe("moving one event", () => {
  it("keeps the same event, players and requests, and tells everyone", async () => {
    const ev = await weeklyEvent();
    await player.client.rpc("attend_event", { p_event_id: ev.id });
    await player.client.rpc("add_requests", { p_event_id: ev.id, p_items: [{ card_id: "test-em-card", quantity: 1 }] });

    const newDate = plusDays(ev.slot_date!, 1);
    expect(
      (await owner.client.rpc("owner_move_event", { p_event_id: ev.id, p_date: newDate, p_start_time: "19:30" })).error,
    ).toBeNull();

    const after = await weeklyEvent();
    expect(after.id).toBe(ev.id);
    expect(after.event_date).toBe(newDate);
    expect(after.slot_date).toBe(ev.slot_date);
    expect(new Date(after.starts_at).toISOString()).toBe(`${newDate}T19:30:00.000Z`);
    expect(new Date(after.moved_from!).toISOString()).toBe(new Date(ev.starts_at).toISOString());

    // No duplicate on the original day.
    const { count } = await admin
      .from("events")
      .select("id", { count: "exact", head: true })
      .eq("schedule_id", scheduleId)
      .eq("slot_date", ev.slot_date!);
    expect(count).toBe(1);

    const { count: going } = await admin.from("attendances").select("user_id", { count: "exact", head: true }).eq("event_id", ev.id);
    expect(going).toBe(1);

    for (const u of [player, follower]) {
      const moved = await notificationsOf(u, "event_moved");
      expect(moved).toHaveLength(1);
      expect(moved[0].payload).toMatchObject({ label: "Armory", store: "Event Manage Store" });
    }
    expect(await notificationsOf(owner, "event_moved")).toHaveLength(0);
  });

  it("clears the moved note when moved back", async () => {
    const ev = await weeklyEvent();
    await owner.client.rpc("owner_move_event", { p_event_id: ev.id, p_date: ev.slot_date!, p_start_time: "18:00" });
    expect((await weeklyEvent()).moved_from).toBeNull();
  });

  it("rejects the past and moves into another week", async () => {
    const ev = await weeklyEvent();
    const move = (date: string) =>
      owner.client.rpc("owner_move_event", { p_event_id: ev.id, p_date: date, p_start_time: "18:00" });
    expect((await move("2020-01-01")).error?.message).toBe("move_in_past");
    expect((await move(plusDays(ev.slot_date!, 7))).error?.message).toBe("move_too_far");
    const stranger = await outsider.client.rpc("owner_move_event", {
      p_event_id: ev.id,
      p_date: plusDays(ev.slot_date!, 1),
      p_start_time: "18:00",
    });
    expect(stranger.error?.message).toBe("not_store_owner");
  });

  it("hands over to next week once an event moved earlier is over", async () => {
    const ev = await weeklyEvent();
    // As if it was moved earlier in the week and has already happened.
    await admin
      .from("events")
      .update({ starts_at: new Date(Date.now() - 7_200_000).toISOString(), ends_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", ev.id);
    const next = await weeklyEvent();
    expect(next.id).not.toBe(ev.id);
    expect(next.slot_date).toBe(plusDays(ev.slot_date!, 7));

    // Put it back for the next tests.
    await admin.from("events").delete().eq("id", next.id);
    await admin.from("events").update({ starts_at: ev.starts_at, ends_at: ev.ends_at }).eq("id", ev.id);
  });
});

describe("changing the weekly slot", () => {
  it("moves open events to the new day and keeps their players", async () => {
    const ev = await weeklyEvent();
    const newWeekday = (weekday + 1) % 7;
    expect(
      (
        await owner.client.rpc("owner_update_schedule", {
          p_schedule_id: scheduleId,
          p_label: "Thursday Armory",
          p_weekday: newWeekday,
          p_start_time: "19:00",
        })
      ).error,
    ).toBeNull();

    const expected = currentEventFor({ weekday: newWeekday, start_time: "19:00" }, "UTC");
    const after = await weeklyEvent();
    expect(after.id).toBe(ev.id);
    expect(after.event_date).toBe(expected.eventDate);
    expect(after.slot_date).toBe(expected.eventDate);
    expect(new Date(after.starts_at).toISOString()).toBe(expected.startsAt.toISOString());
    expect(after.label).toBe("Thursday Armory");

    const { count } = await admin.from("events").select("id", { count: "exact", head: true }).eq("schedule_id", scheduleId);
    expect(count).toBe(1);
    const { count: going } = await admin.from("attendances").select("user_id", { count: "exact", head: true }).eq("event_id", ev.id);
    expect(going).toBe(1);
    expect(await notificationsOf(player, "event_moved")).toHaveLength(3);
  });

  it("only lets owners change, add or pause slots", async () => {
    const args = { p_schedule_id: scheduleId, p_label: "Hack", p_weekday: 1, p_start_time: "10:00" };
    expect((await outsider.client.rpc("owner_update_schedule", args)).error?.message).toBe("not_store_owner");
    expect(
      (await outsider.client.rpc("owner_set_schedule_active", { p_schedule_id: scheduleId, p_active: false })).error?.message,
    ).toBe("not_store_owner");
    const add = await outsider.client.rpc("owner_add_schedule", {
      p_store_id: storeId,
      p_label: "Hack",
      p_weekday: 1,
      p_start_time: "10:00",
    });
    expect(add.error?.message).toBe("not_store_owner");
    expect(
      (await owner.client.rpc("owner_add_schedule", { p_store_id: storeId, p_label: " ", p_weekday: 1, p_start_time: "10:00" }))
        .error?.message,
    ).toBe("invalid_label");
  });

  it("prepares upcoming weeks for owners", async () => {
    const upcoming = must(await owner.client.rpc("owner_upcoming_events", { p_store_id: storeId, p_weeks: 4 }), "upcoming");
    expect(upcoming.filter((e) => e.schedule_id === scheduleId)).toHaveLength(4);
    expect((await outsider.client.rpc("owner_upcoming_events", { p_store_id: storeId })).error?.message).toBe(
      "not_store_owner",
    );
    // Players still see just this week's.
    expect((await currentEvents()).filter((e) => e.schedule_id === scheduleId)).toHaveLength(1);
  });
});

describe("renaming an event", () => {
  it("lets owners and admins rename one event, and slot renames skip it", async () => {
    const mod = await createTestUser({ name: "Rename Admin", isAdmin: true });
    const upcoming = must(await owner.client.rpc("owner_upcoming_events", { p_store_id: storeId, p_weeks: 3 }), "upcoming");
    const [first, second, third] = upcoming.filter((e) => e.schedule_id === scheduleId);
    const label = async (id: string) => (await admin.from("events").select("label").eq("id", id).single()).data!.label;

    expect((await outsider.client.rpc("owner_rename_event", { p_event_id: first.id, p_label: "Hack" })).error?.message).toBe(
      "not_store_owner",
    );
    expect((await owner.client.rpc("owner_rename_event", { p_event_id: first.id, p_label: " " })).error?.message).toBe(
      "invalid_label",
    );
    expect((await owner.client.rpc("owner_rename_event", { p_event_id: first.id, p_label: "  Holiday Armory " })).error).toBeNull();
    expect((await mod.client.rpc("owner_rename_event", { p_event_id: second.id, p_label: "Big Armory" })).error).toBeNull();
    expect(await label(first.id)).toBe("Holiday Armory");

    // Renaming the slot (same day and time) renames the rest, quietly.
    const movedBefore = (await notificationsOf(player, "event_moved")).length;
    const sch = (await admin.from("store_schedules").select("weekday, start_time").eq("id", scheduleId).single()).data!;
    expect(
      (
        await owner.client.rpc("owner_update_schedule", {
          p_schedule_id: scheduleId,
          p_label: "Weekly Armory",
          p_weekday: sch.weekday,
          p_start_time: sch.start_time,
        })
      ).error,
    ).toBeNull();
    expect(await label(first.id)).toBe("Holiday Armory");
    expect(await label(second.id)).toBe("Big Armory");
    expect(await label(third.id)).toBe("Weekly Armory");
    expect(await notificationsOf(player, "event_moved")).toHaveLength(movedBefore);
  });
});

describe("one-off events", () => {
  it("creates an event outside the schedule that players can join", async () => {
    const date = plusDays(new Date().toISOString().slice(0, 10), 2);
    const id = must(
      await owner.client.rpc("owner_create_event", {
        p_store_id: storeId,
        p_label: "Pre-release",
        p_date: date,
        p_start_time: "12:00",
        p_gem_code: "PR-1",
      }),
      "create",
    );
    const listed = (await currentEvents()).find((e) => e.id === id)!;
    expect(listed).toMatchObject({ schedule_id: null, slot_date: null, label: "Pre-release", gem_code: "PR-1" });
    expect((await player.client.rpc("attend_event", { p_event_id: id })).error).toBeNull();

    // Nothing to copy into or out of a one-off.
    const weekly = await weeklyEvent();
    const copy = await player.client.rpc("copy_open_requests", { p_from_event: weekly.id, p_to_event: id });
    expect(copy.error?.message).toBe("invalid_copy");
  });

  it("checks dates, labels and ownership", async () => {
    const create = (u: TestUser, date: string, label = "Special") =>
      u.client.rpc("owner_create_event", { p_store_id: storeId, p_label: label, p_date: date, p_start_time: "12:00" });
    expect((await create(owner, "2020-01-01")).error?.message).toBe("date_in_past");
    expect((await create(owner, plusDays(new Date().toISOString().slice(0, 10), 120))).error?.message).toBe("too_far_ahead");
    expect((await create(owner, plusDays(new Date().toISOString().slice(0, 10), 3), "")).error?.message).toBe("invalid_label");
    expect((await create(outsider, plusDays(new Date().toISOString().slice(0, 10), 3))).error?.message).toBe(
      "not_store_owner",
    );
  });
});

describe("players leaving", () => {
  it("tells the store's owners, unless they turned it off", async () => {
    const ev = await weeklyEvent();
    await outsider.client.rpc("attend_event", { p_event_id: ev.id });
    expect((await outsider.client.rpc("leave_event", { p_event_id: ev.id })).error).toBeNull();

    const left = await notificationsOf(owner, "attendee_left");
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ event_id: ev.id, payload: { actor: "EM Outsider", label: ev.label } });
    expect(await notificationsOf(follower, "attendee_left")).toHaveLength(0);

    // Leaving when not going says nothing.
    await outsider.client.rpc("leave_event", { p_event_id: ev.id });
    expect(await notificationsOf(owner, "attendee_left")).toHaveLength(1);

    await owner.client.from("notification_preferences").insert({ kind: "attendee_left", enabled: false });
    await outsider.client.rpc("attend_event", { p_event_id: ev.id });
    await outsider.client.rpc("leave_event", { p_event_id: ev.id });
    expect(await notificationsOf(owner, "attendee_left")).toHaveLength(1);
  });
});
