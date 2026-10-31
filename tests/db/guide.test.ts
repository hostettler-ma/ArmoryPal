import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

let newbie: TestUser;
let other: TestUser;

beforeAll(async () => {
  [newbie, other] = await Promise.all([createTestUser({ name: "Guide Newbie" }), createTestUser({ name: "Guide Other" })]);
});

afterAll(deleteTestUsers);

const seenAt = async (id: string) =>
  (await admin.from("profiles").select("guide_seen_at").eq("id", id).single()).data!.guide_seen_at;

describe("profiles.guide_seen_at", () => {
  it("starts unset for new accounts", async () => {
    expect(await seenAt(newbie.id)).toBeNull();
  });

  it("lets players mark only their own guide as seen", async () => {
    const now = new Date().toISOString();
    const own = await newbie.client.from("profiles").update({ guide_seen_at: now }).eq("id", newbie.id).select("id");
    expect(own.data).toEqual([{ id: newbie.id }]);
    expect(await seenAt(newbie.id)).not.toBeNull();

    const theirs = await newbie.client.from("profiles").update({ guide_seen_at: now }).eq("id", other.id).select("id");
    expect(theirs.data).toEqual([]);
    expect(await seenAt(other.id)).toBeNull();
  });

  it("is blocked for banned players, like every profile write", async () => {
    await admin.from("bans").insert({ user_id: other.id, reason: "test" });
    const res = await other.client
      .from("profiles")
      .update({ guide_seen_at: new Date().toISOString() })
      .eq("id", other.id)
      .select("id");
    expect(res.data).toEqual([]);
    await admin.from("bans").delete().eq("user_id", other.id);
  });
});
