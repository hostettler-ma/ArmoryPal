import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

let owner: TestUser;
let player: TestUser; // going
let follower: TestUser; // saved the store
let outsider: TestUser;
let storeId: string;
let scheduleId: string;
let eventId: string;
const weekday = (new Date().getUTCDay() + 3) % 7;

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error || res.data === null) throw new Error(`${what}: ${res.error?.message ?? "no data"}`);
  return res.data;
}

const votes = async () =>
  must(await player.client.from("format_votes").select("user_id, format").eq("event_id", eventId), "votes");
const notificationsOf = async (u: TestUser, kind: string) =>
  must(await u.client.from("notifications").select("payload").eq("kind", kind).eq("event_id", eventId), kind);

beforeAll(async () => {
  [owner, player, follower, outsider] = await Promise.all([
    createTestUser({ name: "Poll Owner" }),
    createTestUser({ name: "Poll Player" }),
    createTestUser({ name: "Poll Follower" }),
    createTestUser({ name: "Poll Outsider" }),
  ]);
  const { data: store } = await admin
    .from("stores")
    .insert({ name: "Poll Test Store", city: "Pollville", country: "Testland", timezone: "UTC" })
    .select()
    .single();
  storeId = store!.id;
  await admin.from("store_owners").insert({ store_id: storeId, user_id: owner.id });
  await admin.from("user_stores").insert({ store_id: storeId, user_id: follower.id });
  const { data: sched } = await admin
    .from("store_schedules")
    .insert({ store_id: storeId, weekday, start_time: "18:00" })
    .select()
    .single();
  scheduleId = sched!.id;
  const events = must(await player.client.rpc("current_events_for_stores", { p_store_ids: [storeId] }), "events");
  eventId = events[0].id;
  await player.client.rpc("attend_event", { p_event_id: eventId });
});

afterAll(async () => {
  await admin.from("events").delete().eq("store_id", storeId);
  await admin.from("stores").delete().eq("id", storeId);
  await deleteTestUsers();
});

describe("one-time poll", () => {
  it("only lets owners open it, with valid options", async () => {
    expect((await player.client.rpc("vote_format", { p_event_id: eventId, p_format: "cc" })).error?.message).toBe("no_poll");
    expect(
      (await outsider.client.rpc("owner_open_poll", { p_event_id: eventId, p_options: ["draft", "cc"] })).error?.message,
    ).toBe("not_store_owner");
    expect(
      (await owner.client.rpc("owner_open_poll", { p_event_id: eventId, p_options: ["draft"] })).error?.message,
    ).toBe("invalid_poll_options");
    expect(
      (await owner.client.rpc("owner_open_poll", { p_event_id: eventId, p_options: ["draft", "chess"] })).error?.message,
    ).toBe("invalid_poll_options");
    expect(
      (await owner.client.rpc("owner_open_poll", { p_event_id: eventId, p_options: ["draft", "cc", "silver_age"] })).error,
    ).toBeNull();
    expect(
      (await owner.client.rpc("owner_open_poll", { p_event_id: eventId, p_options: ["draft", "cc"] })).error?.message,
    ).toBe("poll_exists");

    // The audience hears about it; the owner doesn't.
    expect(await notificationsOf(player, "format_poll_opened")).toHaveLength(1);
    expect(await notificationsOf(follower, "format_poll_opened")).toHaveLength(1);
    expect(await notificationsOf(owner, "format_poll_opened")).toHaveLength(0);
  });

  it("lets the audience vote once each, and change or take back the vote", async () => {
    expect((await player.client.rpc("vote_format", { p_event_id: eventId, p_format: "draft" })).error).toBeNull();
    expect((await player.client.rpc("vote_format", { p_event_id: eventId, p_format: "cc" })).error).toBeNull();
    expect((await follower.client.rpc("vote_format", { p_event_id: eventId, p_format: "cc" })).error).toBeNull();
    expect(await votes()).toHaveLength(2);

    expect((await outsider.client.rpc("vote_format", { p_event_id: eventId, p_format: "cc" })).error?.message).toBe(
      "not_in_audience",
    );
    expect((await player.client.rpc("vote_format", { p_event_id: eventId, p_format: "csp" })).error?.message).toBe(
      "invalid_format",
    );
    // No direct writes.
    const direct = await outsider.client.from("format_votes").insert({ event_id: eventId, user_id: outsider.id, format: "cc" });
    expect(direct.error).not.toBeNull();

    expect((await follower.client.rpc("clear_format_vote", { p_event_id: eventId })).error).toBeNull();
    expect(await votes()).toEqual([{ user_id: player.id, format: "cc" }]);
  });

  it("can't be removed once people voted", async () => {
    expect((await owner.client.rpc("owner_delete_poll", { p_event_id: eventId })).error?.message).toBe("poll_has_votes");
  });

  it("closes when the owner confirms a format, and tells everyone", async () => {
    expect((await player.client.rpc("owner_confirm_format", { p_event_id: eventId, p_format: "cc" })).error?.message).toBe(
      "not_store_owner",
    );
    expect((await owner.client.rpc("owner_confirm_format", { p_event_id: eventId, p_format: "cc" })).error).toBeNull();
    const { data: ev } = await admin.from("events").select("format").eq("id", eventId).single();
    expect(ev!.format).toBe("cc");

    expect((await player.client.rpc("vote_format", { p_event_id: eventId, p_format: "draft" })).error?.message).toBe(
      "poll_closed",
    );
    expect((await player.client.rpc("clear_format_vote", { p_event_id: eventId })).error?.message).toBe("poll_closed");

    const confirmed = await notificationsOf(follower, "format_confirmed");
    expect(confirmed).toEqual([{ payload: { store: "Poll Test Store", label: "Armory", format: "cc" } }]);
    // Re-confirming the same format doesn't notify again.
    await owner.client.rpc("owner_confirm_format", { p_event_id: eventId, p_format: "cc" });
    expect(await notificationsOf(follower, "format_confirmed")).toHaveLength(1);
  });
});

describe("weekly polls", () => {
  it("adds a poll to every new event of the slot", async () => {
    expect(
      (
        await outsider.client.rpc("owner_set_weekly_poll", {
          p_schedule_id: scheduleId,
          p_on: true,
          p_options: ["draft", "cc"],
        })
      ).error?.message,
    ).toBe("not_store_owner");
    expect(
      (
        await owner.client.rpc("owner_set_weekly_poll", {
          p_schedule_id: scheduleId,
          p_on: true,
          p_options: ["silver_age", "csp"],
        })
      ).error,
    ).toBeNull();

    const upcoming = must(await owner.client.rpc("owner_upcoming_events", { p_store_id: storeId, p_weeks: 3 }), "upcoming");
    const later = upcoming.filter((e) => e.id !== eventId);
    expect(later).toHaveLength(2);
    const { data: polls } = await admin.from("format_polls").select("event_id, options").in("event_id", later.map((e) => e.id));
    expect(polls).toHaveLength(2);
    expect(polls![0].options).toEqual(["silver_age", "csp"]);

    // Weekly polls open silently.
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("kind", "format_poll_opened")
      .in("event_id", later.map((e) => e.id));
    expect(count).toBe(0);

    // This week's already has a format (and a poll), so it's left alone.
    const { data: mine } = await admin.from("format_polls").select("options").eq("event_id", eventId).single();
    expect(mine!.options).toEqual(["draft", "cc", "silver_age"]);
  });

  it("turning it off removes the weekly polls nobody voted in, and keeps the rest", async () => {
    const upcoming = must(await owner.client.rpc("owner_upcoming_events", { p_store_id: storeId, p_weeks: 3 }), "upcoming");
    const [voted, empty] = upcoming.filter((e) => e.id !== eventId).map((e) => e.id);
    expect((await follower.client.rpc("vote_format", { p_event_id: voted, p_format: "csp" })).error).toBeNull();

    expect(
      (await owner.client.rpc("owner_set_weekly_poll", { p_schedule_id: scheduleId, p_on: false, p_options: ["silver_age", "csp"] }))
        .error,
    ).toBeNull();

    const { data: left } = await admin.from("format_polls").select("event_id").in("event_id", [eventId, voted, empty]);
    expect(left!.map((p) => p.event_id).sort()).toEqual([eventId, voted].sort());
    const { data: sch } = await admin.from("store_schedules").select("weekly_format_poll").eq("id", scheduleId).single();
    expect(sch!.weekly_format_poll).toBe(false);

    // New weeks get no poll while it's off.
    const more = must(await owner.client.rpc("owner_upcoming_events", { p_store_id: storeId, p_weeks: 5 }), "more");
    const { count } = await admin
      .from("format_polls")
      .select("event_id", { count: "exact", head: true })
      .in("event_id", more.map((e) => e.id).filter((id) => ![eventId, voted].includes(id)));
    expect(count).toBe(0);
  });
});
