import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "./helpers";

// Made-up names so the test doesn't depend on the imported catalog.
const CARDS = [
  { id: "test-im-1", name: "Zorbli's Mighty Fist", pitch: null, color: null, types: ["Generic"] },
  { id: "test-im-2", name: "Crown of Zorbli Thoughts", pitch: null, color: null, types: ["Generic"] },
  { id: "test-im-3", name: "Zorbli Drop", pitch: 1, color: "Red", types: ["Generic"] },
  { id: "test-im-4", name: "Zorbli Drop", pitch: 3, color: "Blue", types: ["Generic"] },
];

let player: TestUser;

beforeAll(async () => {
  const { error } = await admin.from("cards").upsert(CARDS);
  if (error) throw error;
  player = await createTestUser();
});

afterAll(async () => {
  await admin.from("cards").delete().in("id", CARDS.map((c) => c.id));
  await deleteTestUsers();
});

const resolve = async (names: string[]) => {
  const { data, error } = await player.client.rpc("resolve_card_names", { p_names: names });
  expect(error).toBeNull();
  return data!.map((r) => [r.idx, r.name, r.match]);
};

describe("resolve_card_names", () => {
  it("matches ignoring case, punctuation and extra spaces, keeping input order", async () => {
    expect(await resolve(["zorblis  mighty fist", "ZORBLI DROP", "Zorbli's Mighty Fist"])).toEqual([
      [1, "Zorbli's Mighty Fist", "exact"],
      [2, "Zorbli Drop", "exact"],
      [3, "Zorbli's Mighty Fist", "exact"],
    ]);
  });

  it("accepts close typos and flags them, but not unrelated names", async () => {
    expect(await resolve(["Crown of Zorbli Toughts", "Completely Unrelated Name", ""])).toEqual([
      [1, "Crown of Zorbli Thoughts", "typo"],
      [2, null, null],
      [3, null, null],
    ]);
  });

  it("caps a call at 200 names", async () => {
    const { data } = await player.client.rpc("resolve_card_names", { p_names: Array(250).fill("Zorbli Drop") });
    expect(data).toHaveLength(200);
  });

  it("refuses anonymous callers", async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false },
    });
    const { error } = await anon.rpc("resolve_card_names", { p_names: ["Zorbli Drop"] });
    expect(error).not.toBeNull();
  });
});
