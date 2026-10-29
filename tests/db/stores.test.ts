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

  it("finds stores by city with a typo", async () => {
    const { data, error } = await player.client.rpc("search_stores", { q: "Tesvtille" });
    expect(error).toBeNull();
    expect(data!.map((s) => s.id)).toContain(storeIds[0]);
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
