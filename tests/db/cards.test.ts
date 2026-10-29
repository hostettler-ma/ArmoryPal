import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

// Fixture cards with made-up names so the test doesn't depend on the imported catalog.
const fixtures = [
  { id: "test-zx-1", name: "Zyxquat Strike", pitch: 1, color: "Red", types: ["Generic", "Action"] },
  { id: "test-zx-2", name: "Zyxquat Strike", pitch: 2, color: "Yellow", types: ["Generic", "Action"] },
  { id: "test-zx-3", name: "Zyxquat Strike", pitch: 3, color: "Blue", types: ["Generic", "Action"] },
  { id: "test-zx-4", name: "Cloak of Zyxquat", pitch: null, color: null, types: ["Generic", "Equipment"] },
  { id: "test-zx-5", name: "Zyxquat 100% Proof", pitch: 1, color: "Red", types: ["Generic", "Action"] },
];

let player: TestUser;

beforeAll(async () => {
  const { error } = await admin.from("cards").upsert(fixtures);
  if (error) throw error;
  player = await createTestUser();
});

afterAll(async () => {
  await admin.from("cards").delete().in("id", fixtures.map((f) => f.id));
  await deleteTestUsers();
});

const search = async (q: string, max = 10) => {
  const { data, error } = await player.client.rpc("search_cards", { q, max_results: max });
  expect(error).toBeNull();
  return data!.filter((c) => c.id.startsWith("test-zx-"));
};

describe("cards table", () => {
  it("is readable but not writable by users", async () => {
    const { data } = await player.client.from("cards").select("id").eq("id", "test-zx-1");
    expect(data).toHaveLength(1);

    const { error } = await player.client.from("cards").insert({ id: "test-zx-evil", name: "Evil" });
    expect(error?.code).toBe("42501");

    // Refused outright (no UPDATE grant → null) or filtered to nothing by RLS ([]): either way, unchanged.
    const { data: updated } = await player.client.from("cards").update({ name: "Renamed" }).eq("id", "test-zx-1").select();
    expect(updated ?? []).toEqual([]);
    const { data: after } = await admin.from("cards").select("name").eq("id", "test-zx-1").single();
    expect(after!.name).toBe("Zyxquat Strike");
  });

  it("enforces one row per name + pitch, including pitchless cards", async () => {
    const { error } = await admin.from("cards").insert({ id: "test-zx-dupe", name: "Cloak of Zyxquat", pitch: null });
    expect(error?.code).toBe("23505");
  });
});

describe("search_cards", () => {
  it("ranks prefix matches before substring matches, and pitch variants in pitch order", async () => {
    const ids = (await search("zyxq")).map((c) => c.id);
    expect(ids.slice(0, 4).sort()).toEqual(["test-zx-1", "test-zx-2", "test-zx-3", "test-zx-5"]);
    expect(ids[4]).toBe("test-zx-4"); // "Cloak of Zyxquat": substring only
    expect(ids.filter((id) => ["test-zx-1", "test-zx-2", "test-zx-3"].includes(id))).toEqual([
      "test-zx-1",
      "test-zx-2",
      "test-zx-3",
    ]);
  });

  it("tolerates typos", async () => {
    const ids = (await search("zyxqaut strike")).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["test-zx-1", "test-zx-2", "test-zx-3"]));
  });

  it("treats % and _ literally", async () => {
    const ids = (await search("zyxquat 100%")).map((c) => c.id);
    expect(ids[0]).toBe("test-zx-5");
    expect(await search("%%")).toEqual([]);
  });

  it("limits by distinct names and never splits a name's pitch variants", async () => {
    // Only the top name is requested, but all three of its colors come back together.
    const { data } = await player.client.rpc("search_cards", { q: "zyxquat strike", max_results: 1 });
    expect(data!.map((c) => c.id)).toEqual(["test-zx-1", "test-zx-2", "test-zx-3"]);
  });

  it("returns each name's variants contiguously", async () => {
    const names = (await search("zyxq")).map((c) => c.name);
    const runs = names.filter((n, i) => n !== names[i - 1]);
    expect(new Set(runs).size).toBe(runs.length);
  });

  it("ignores queries shorter than 2 characters and caps at 50 names", async () => {
    const { data: short } = await player.client.rpc("search_cards", { q: "z" });
    expect(short).toEqual([]);
    const { data: capped } = await player.client.rpc("search_cards", { q: "st", max_results: 500 });
    expect(new Set(capped!.map((c) => c.name)).size).toBe(50);
  });
});
