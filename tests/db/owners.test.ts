import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

let mod: TestUser; // admin
let player: TestUser; // asks to own the store
let other: TestUser;
let storeId: string;
let otherStoreId: string;

async function newStore(name: string) {
  const { data } = await admin
    .from("stores")
    .insert({ name, city: "Ownerville", country: "Testland", timezone: "UTC" })
    .select()
    .single();
  return data!.id as string;
}

beforeAll(async () => {
  [mod, player, other] = await Promise.all([
    createTestUser({ name: "Owner Mod", isAdmin: true }),
    createTestUser({ name: "Would-be Owner" }),
    createTestUser({ name: "Owner Other" }),
  ]);
  storeId = await newStore("Ownership Test Store");
  otherStoreId = await newStore("Ownership Other Store");
});

afterAll(async () => {
  await admin.from("admin_actions").delete().in("target_store", [storeId, otherStoreId]);
  await admin.from("stores").delete().in("id", [storeId, otherStoreId]);
  await deleteTestUsers();
});

const pendingFor = async (u: TestUser, store = storeId) =>
  (
    await admin
      .from("store_owner_requests")
      .select("id")
      .eq("user_id", u.id)
      .eq("store_id", store)
      .eq("status", "pending")
      .maybeSingle()
  ).data?.id;

describe("store ownership", () => {
  it("lets a player request once, and nobody else can approve", async () => {
    const first = await player.client.rpc("request_store_ownership", { p_store_id: storeId, p_message: "I run it" });
    expect(first.error).toBeNull();
    const again = await player.client.rpc("request_store_ownership", { p_store_id: storeId });
    expect(again.error?.message).toBe("request_pending");

    const id = (await pendingFor(player))!;
    const sneaky = await other.client.rpc("admin_decide_ownership_request", { p_request_id: id, p_approve: true });
    expect(sneaky.error?.message).toBe("not_admin");
    const self = await player.client.rpc("admin_decide_ownership_request", { p_request_id: id, p_approve: true });
    expect(self.error?.message).toBe("not_admin");

    // Requests are private: others can't read them.
    const { data: seen } = await other.client.from("store_owner_requests").select("id").eq("id", id);
    expect(seen).toEqual([]);
  });

  it("makes the player an owner when an admin approves, and tells them", async () => {
    expect(await player.client.rpc("can_manage_store", { p_store_id: storeId }).then((r) => r.data)).toBe(false);
    const id = (await pendingFor(player))!;
    const { error } = await mod.client.rpc("admin_decide_ownership_request", {
      p_request_id: id,
      p_approve: true,
      p_note: "Welcome",
    });
    expect(error).toBeNull();

    expect(await player.client.rpc("can_manage_store", { p_store_id: storeId }).then((r) => r.data)).toBe(true);
    expect(await player.client.rpc("can_manage_store", { p_store_id: otherStoreId }).then((r) => r.data)).toBe(false);
    expect(await other.client.rpc("can_manage_store", { p_store_id: storeId }).then((r) => r.data)).toBe(false);
    // Admins manage every store.
    expect(await mod.client.rpc("can_manage_store", { p_store_id: otherStoreId }).then((r) => r.data)).toBe(true);

    const { data: notes } = await player.client
      .from("notifications")
      .select("kind, payload")
      .eq("kind", "ownership_decided");
    expect(notes).toEqual([
      { kind: "ownership_decided", payload: { approved: true, store: "Ownership Test Store", store_id: storeId, note: "Welcome" } },
    ]);

    const again = await player.client.rpc("request_store_ownership", { p_store_id: storeId });
    expect(again.error?.message).toBe("already_owner");

    const { data: log } = await admin.from("admin_actions").select("action").eq("target_store", storeId);
    expect(log?.map((l) => l.action)).toContain("approve_owner");
  });

  it("blocks direct writes to owners and requests", async () => {
    const insert = await other.client.from("store_owners").insert({ store_id: storeId, user_id: other.id });
    expect(insert.error).not.toBeNull();
    const fake = await other.client
      .from("store_owner_requests")
      .insert({ store_id: storeId, user_id: other.id, status: "approved" });
    expect(fake.error).not.toBeNull();
  });

  it("rejects and withdraws requests", async () => {
    await other.client.rpc("request_store_ownership", { p_store_id: otherStoreId });
    const id = (await pendingFor(other, otherStoreId))!;
    expect(
      (await mod.client.rpc("admin_decide_ownership_request", { p_request_id: id, p_approve: false, p_note: "Nope" }))
        .error,
    ).toBeNull();
    expect(await other.client.rpc("can_manage_store", { p_store_id: otherStoreId }).then((r) => r.data)).toBe(false);
    const twice = await mod.client.rpc("admin_decide_ownership_request", { p_request_id: id, p_approve: true });
    expect(twice.error?.message).toBe("ownership_request_not_found");

    await other.client.rpc("request_store_ownership", { p_store_id: otherStoreId });
    const second = (await pendingFor(other, otherStoreId))!;
    expect((await player.client.rpc("cancel_ownership_request", { p_request_id: second })).error?.message).toBe(
      "ownership_request_not_found",
    );
    expect((await other.client.rpc("cancel_ownership_request", { p_request_id: second })).error).toBeNull();
    expect(await pendingFor(other, otherStoreId)).toBeUndefined();
  });

  it("removes owners, and a ban ends ownership", async () => {
    await other.client.rpc("request_store_ownership", { p_store_id: storeId });
    await mod.client.rpc("admin_decide_ownership_request", {
      p_request_id: (await pendingFor(other))!,
      p_approve: true,
    });
    expect(await other.client.rpc("can_manage_store", { p_store_id: storeId }).then((r) => r.data)).toBe(true);
    expect((await mod.client.rpc("admin_remove_store_owner", { p_store_id: storeId, p_user_id: other.id })).error).toBeNull();
    expect(await other.client.rpc("can_manage_store", { p_store_id: storeId }).then((r) => r.data)).toBe(false);

    expect((await mod.client.rpc("admin_ban", { p_user_id: player.id, p_reason: "Test" })).error).toBeNull();
    const { data: owners } = await admin.from("store_owners").select("user_id").eq("user_id", player.id);
    expect(owners).toEqual([]);
    await mod.client.rpc("admin_unban", { p_user_id: player.id });
  });
});
