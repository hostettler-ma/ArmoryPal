import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

const storeRow = (name: string) => ({
  name,
  city: "Testville",
  country: "Testland",
  timezone: "America/Chicago",
});

let player: TestUser;
let other: TestUser;
let boss: TestUser;
const storeIds: string[] = [];

beforeAll(async () => {
  [player, other, boss] = await Promise.all([
    createTestUser({ name: "Player" }),
    createTestUser({ name: "Other" }),
    createTestUser({ name: "Boss", isAdmin: true }),
  ]);
});

afterAll(async () => {
  if (storeIds.length) await admin.from("stores").delete().in("id", storeIds);
  await deleteTestUsers();
});

describe("stores RLS", () => {
  it("lets an admin create a store and schedule", async () => {
    const { data, error } = await boss.client.from("stores").insert(storeRow("Admin Store")).select().single();
    expect(error).toBeNull();
    storeIds.push(data!.id);
    expect(data!.created_by).toBe(boss.id);

    const { error: schedError } = await boss.client
      .from("store_schedules")
      .insert({ store_id: data!.id, weekday: 2, start_time: "18:30" });
    expect(schedError).toBeNull();
  });

  it("blocks non-admins from creating, editing, or deleting stores", async () => {
    const { error } = await player.client.from("stores").insert(storeRow("Sneaky Store"));
    expect(error?.code).toBe("42501"); // RLS violation

    const { data: updated } = await player.client
      .from("stores")
      .update({ name: "Hijacked" })
      .eq("id", storeIds[0])
      .select();
    expect(updated).toEqual([]);

    const { data: deleted } = await player.client.from("stores").delete().eq("id", storeIds[0]).select();
    expect(deleted).toEqual([]);
  });

  it("blocks non-admins from adding schedules", async () => {
    const { error } = await player.client
      .from("store_schedules")
      .insert({ store_id: storeIds[0], weekday: 1, start_time: "18:00" });
    expect(error?.code).toBe("42501");
  });

  it("rejects an invalid time zone even for admins", async () => {
    const { error } = await boss.client.from("stores").insert({ ...storeRow("Bad TZ"), timezone: "Mars/Base" });
    expect(error?.code).toBe("23514"); // check violation
  });

  it("lets admins set notes up to 500 characters, but not non-admins", async () => {
    const ok = await boss.client.from("stores").update({ notes: "Pre-register online.\nDoors 6:30." }).eq("id", storeIds[0]);
    expect(ok.error).toBeNull();
    const tooLong = await boss.client.from("stores").update({ notes: "x".repeat(501) }).eq("id", storeIds[0]);
    expect(tooLong.error?.code).toBe("23514");
    const { data: byPlayer } = await player.client.from("stores").update({ notes: "hijacked" }).eq("id", storeIds[0]).select();
    expect(byPlayer).toEqual([]);
  });

  it("finds stores by city with a typo", async () => {
    const { data, error } = await player.client.rpc("search_stores", { q: "Tesvtille" });
    expect(error).toBeNull();
    expect(data!.map((s) => s.id)).toContain(storeIds[0]);
  });
});

describe("search_stores ordering", () => {
  // Weekday: 0 = Sunday … 6 = Saturday. Expected order for "qorvex":
  //   tier 0 (exact name/city): Hilltop Cards (city Qorvex, Wed) before Qorvex (Sun)
  //   tier 1 (word prefix):     Big Qorvex Hall (Mon), Qorvex Games (Fri), Qorvex Annex (no slot → last)
  //   tier 2 (contains):        SuperQorvexium (Tue)
  const fixtures = [
    { name: "Qorvex", city: "Testville", slot: { weekday: 0, start_time: "12:00" } },
    { name: "Hilltop Cards", city: "Qorvex", slot: { weekday: 3, start_time: "19:00" } },
    { name: "Qorvex Games", city: "Testville", slot: { weekday: 5, start_time: "19:00" } },
    { name: "Big Qorvex Hall", city: "Testville", slot: { weekday: 1, start_time: "18:30" } },
    { name: "Qorvex Annex", city: "Testville", slot: null },
    { name: "SuperQorvexium", city: "Testville", slot: { weekday: 2, start_time: "19:00" } },
  ];

  beforeAll(async () => {
    for (const f of fixtures) {
      const { data } = await admin
        .from("stores")
        .insert({ name: f.name, city: f.city, country: "Testland", timezone: "UTC" })
        .select("id")
        .single();
      storeIds.push(data!.id);
      if (f.slot) await admin.from("store_schedules").insert({ store_id: data!.id, ...f.slot });
    }
  });

  it("orders by match tier, then earliest weekly slot (Monday first), stores without slots last", async () => {
    const { data, error } = await player.client.rpc("search_stores", { q: "qorvex" });
    expect(error).toBeNull();
    expect(data!.map((s) => s.name)).toEqual([
      "Hilltop Cards",
      "Qorvex",
      "Big Qorvex Hall",
      "Qorvex Games",
      "Qorvex Annex",
      "SuperQorvexium",
    ]);
  });

  it("treats % and _ in the query literally", async () => {
    const { data } = await player.client.rpc("search_stores", { q: "%" });
    expect(data).toEqual([]);
  });
});

describe("user_stores RLS", () => {
  it("lets users manage only their own list", async () => {
    const { error } = await player.client.from("user_stores").insert({ user_id: player.id, store_id: storeIds[0] });
    expect(error).toBeNull();

    const { error: forOther } = await player.client
      .from("user_stores")
      .insert({ user_id: other.id, store_id: storeIds[0] });
    expect(forOther?.code).toBe("42501");

    const { data: seenByOther } = await other.client.from("user_stores").select().eq("user_id", player.id);
    expect(seenByOther).toEqual([]);

    const { data: removedByOther } = await other.client
      .from("user_stores")
      .delete()
      .eq("user_id", player.id)
      .select();
    expect(removedByOther).toEqual([]);
  });
});
