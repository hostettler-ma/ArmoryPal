import { currentEventFor } from "../../src/lib/events";
import { expect, test, uid } from "../support/fixtures";
import { admin } from "../support/supabase";
import { attend, sheet } from "../support/ui";

/**
 * The store-owner flow: a player asks to manage a store, an admin approves,
 * the owner links GEM and tickets, moves this week's event and runs a format
 * poll, and a player sees all of it. Uses its own store so it can't disturb
 * the shared E2E store.
 */

let storeId: string;
let storeName: string;
// Three days ahead (UTC store), so this week's event is safely in the future.
const weekday = (new Date().getUTCDay() + 3) % 7;

test.beforeEach(async () => {
  storeName = `Owner Test ${uid()}`;
  const { data, error } = await admin()
    .from("stores")
    .insert({ name: storeName, city: "Ownerton", country: "Testland", timezone: "UTC" })
    .select("id")
    .single();
  if (error) throw error;
  storeId = data.id;
  await admin().from("store_schedules").insert({ store_id: storeId, weekday, start_time: "18:00", label: "Owner Armory" });
});

test.afterEach(async () => {
  await admin().from("admin_actions").delete().eq("target_store", storeId);
  await admin().from("events").delete().eq("store_id", storeId);
  await admin().from("stores").delete().eq("id", storeId);
});

const plusDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

test("a store owner links, moves and polls their event; players see it", async ({ newPlayer }) => {
  const owner = await newPlayer({ name: `Owner ${uid()}` });
  const mod = await newPlayer({ name: `Mod ${uid()}`, isAdmin: true });
  const player = await newPlayer({ name: `Guest ${uid()}` });

  // 1. The owner asks to manage the store.
  await owner.page.goto(`/stores/${storeId}`);
  await owner.page.getByRole("button", { name: "I run this store" }).click();
  const ask = sheet(owner.page, `Manage ${storeName}?`);
  await ask.getByLabel(/How are you connected/).fill("I run the Armory there");
  await ask.getByRole("button", { name: "Send request" }).click();
  await expect(owner.page.getByText("waiting for an admin")).toBeVisible();

  // 2. An admin approves it.
  await mod.page.goto("/admin/owners");
  const request = mod.page.locator("main li").filter({ hasText: storeName });
  await expect(request).toContainText("I run the Armory there");
  await request.getByRole("button", { name: "Approve" }).click();
  await mod.page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(mod.page.getByText("No requests waiting.")).toBeVisible();

  // 3. The owner opens their dashboard (one store → straight to it) and this week's event.
  await owner.page.goto("/manage");
  await expect(owner.page).toHaveURL(new RegExp(`/manage/stores/${storeId}$`));
  await expect(owner.page.getByRole("heading", { name: storeName })).toBeVisible();
  await owner.page.getByRole("link", { name: /Owner Armory/ }).first().click();
  await expect(owner.page).toHaveURL(/\/manage\/events\//);
  const eventId = owner.page.url().split("/").pop()!;

  // Links.
  await owner.page.getByLabel(/GEM event/).fill("12345");
  await owner.page.getByLabel(/Ticket link/).fill("https://shop.example.com/armory");
  await owner.page.getByRole("button", { name: "Save links" }).click();
  await expect(owner.page.getByRole("button", { name: "Saved ✓" })).toBeVisible();

  // Move it a day later.
  const slot = currentEventFor({ weekday, start_time: "18:00" }, "UTC").eventDate;
  await owner.page.getByRole("button", { name: "Move this event" }).click();
  const move = sheet(owner.page, "Move this event");
  await move.getByLabel("Day").fill(plusDays(slot, 1));
  await move.getByLabel("Starts").fill("19:30");
  await move.getByRole("button", { name: "Move event" }).click();
  await expect(owner.page.getByText(/Moved from/)).toBeVisible();

  // Poll.
  await owner.page.getByRole("button", { name: "Start a format poll" }).click();
  await sheet(owner.page, "Format poll").getByRole("button", { name: "Start poll" }).click();
  await expect(owner.page.getByText("Poll is open")).toBeVisible();

  // 4. A player sees the links, the move, and votes.
  await player.page.goto(`/events/${eventId}`);
  await attend(player.page);
  await expect(player.page.getByRole("link", { name: /Buy a ticket/ })).toHaveAttribute(
    "href",
    "https://shop.example.com/armory",
  );
  await expect(player.page.getByText("12345")).toBeVisible();
  await expect(player.page.getByText(/Moved from/)).toBeVisible();
  const poll = player.page.getByRole("region", { name: "Format poll" });
  await poll.getByRole("button", { name: /Draft/ }).click();
  await expect(poll.getByRole("button", { name: /Draft/ })).toHaveAttribute("aria-pressed", "true");

  // 5. The owner confirms Draft; the player sees it.
  await owner.page.reload();
  await owner.page.locator("main li").filter({ hasText: "Draft" }).getByRole("button", { name: "Run this" }).click();
  await expect(owner.page.getByText("Format: Draft")).toBeVisible();
  await player.page.reload();
  await expect(player.page.getByText("Format: Draft")).toBeVisible();

  // 6. When the player leaves, the owner is told.
  await player.page.getByRole("button", { name: "I can't make it" }).click();
  await expect(player.page.getByRole("button", { name: "I'm going" })).toBeVisible();
  await expect
    .poll(async () => {
      const { count } = await admin()
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", owner.id)
        .eq("kind", "attendee_left");
      return count;
    })
    .toBe(1);
});

test("an owner cancels an event with a message, then deletes it", async ({ newPlayer }) => {
  const owner = await newPlayer({ name: `Owner ${uid()}` });
  const player = await newPlayer({ name: `Fan ${uid()}` });
  await admin().from("store_owners").insert({ store_id: storeId, user_id: owner.id });
  await admin().from("user_stores").insert({ store_id: storeId, user_id: player.id });

  // Cancel this week's event with a message.
  await owner.page.goto(`/manage/stores/${storeId}`);
  await owner.page.getByRole("link", { name: /Owner Armory/ }).first().click();
  await expect(owner.page).toHaveURL(/\/manage\/events\//);
  const eventId = owner.page.url().split("/").pop()!;
  await owner.page.getByRole("button", { name: "Cancel this event" }).click();
  const cancel = sheet(owner.page, "Cancel this event");
  await cancel.getByLabel(/Message for players/).fill("Closed for Thanksgiving");
  await cancel.getByRole("button", { name: "Cancel event" }).click();
  await expect(owner.page.getByText("This event is cancelled")).toBeVisible();

  // The follower still sees it, marked cancelled and read-only, and was told.
  await player.page.goto(`/events/${eventId}`);
  await expect(player.page.getByText("This event is cancelled")).toBeVisible();
  await expect(player.page.getByText("Closed for Thanksgiving")).toBeVisible();
  await expect(player.page.getByRole("button", { name: "I'm going" })).toHaveCount(0);
  await player.page.goto("/notifications");
  await expect(player.page.getByText(/is cancelled\. Closed for Thanksgiving/)).toBeVisible();

  // Delete the cancelled event: it disappears for players.
  await owner.page.getByRole("button", { name: "Delete this event" }).click();
  await sheet(owner.page, "Delete this event?").getByRole("button", { name: "Delete event" }).click();
  await expect(owner.page).toHaveURL(new RegExp(`/manage/stores/${storeId}$`));
  expect((await player.page.goto(`/events/${eventId}`))?.status()).toBe(404);
});
