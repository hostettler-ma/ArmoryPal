import { expect, test, uid } from "../support/fixtures";
import { E2E_STORE_ID } from "../support/env";
import { admin, currentEventId } from "../support/supabase";

test("Home's next-Armory card: event, going count, what I'm bringing, live", async ({ newPlayer }) => {
  const me = await newPlayer({ name: `Me ${uid()}` });
  const friend = await newPlayer({ name: `Friend ${uid()}` });
  const eventId = await currentEventId(me.db, E2E_STORE_ID);

  // Not going anywhere yet: no card, and a nudge once I follow a store.
  await me.page.goto("/");
  await expect(me.page.getByRole("region", { name: "Your next Armory" })).toHaveCount(0);
  await admin().from("user_stores").insert({ user_id: me.id, store_id: E2E_STORE_ID });
  await me.page.reload();
  await expect(me.page.getByText("You're not signed up for an Armory yet.")).toBeVisible();

  // Going, but bringing nothing.
  await me.db.rpc("attend_event", { p_event_id: eventId });
  await me.page.reload();
  const card = me.page.getByRole("region", { name: "Your next Armory" });
  await expect(card).toContainText("E2E Armory");
  await expect(card).toContainText("You're not bringing any cards yet.");
  const going = card.locator("p", { hasText: /^\d+$/ }).first();
  const before = Number(await going.textContent());

  // A friend joins and asks for a card; the going count updates without a reload.
  await friend.db.rpc("attend_event", { p_event_id: eventId });
  await expect(going).toHaveText(String(before + 1));
  await friend.db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "e2e-snatch-blue", quantity: 2 }], p_note: "" });

  // Browse requests → promise to bring them → Home summarizes it.
  await card.getByRole("link", { name: "Browse requests" }).click();
  await expect(me.page).toHaveURL(new RegExp(`/events/${eventId}\\?tab=requests`));
  const { data: req } = await admin().from("requests").select("id").eq("requester_id", friend.id).single();
  await me.db.rpc("pledge", { p_request_id: req!.id, p_quantity: 2 });
  await me.page.goto("/");
  await expect(card.getByRole("heading", { name: "Bringing 2 cards for 1 player" })).toBeVisible();
  await expect(card).toContainText(`2× Zeetest Snatch (Blue)`);
  await expect(card).toContainText(`for ${friend.name}`);
  await card.getByRole("link", { name: "Checklist" }).click();
  await expect(me.page).toHaveURL(new RegExp(`/events/${eventId}\\?tab=checklist`));
  await expect(me.page.getByText("2× Zeetest Snatch (Blue)")).toBeVisible();

  // Leaving the event removes the card from Home.
  await me.db.rpc("leave_event", { p_event_id: eventId, p_cancel_requests: true });
  await me.page.goto("/");
  await expect(me.page.getByRole("region", { name: "Your next Armory" })).toHaveCount(0);
});
