import { mkdirSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { admin } from "../support/supabase";
import { openEvent } from "../support/ui";

/**
 * Example screenshots for the /about page: a made-up store and players at a realistic
 * Armory, captured at phone size into public/tour/. Run with `npm run tour:screenshots`
 * (playwright.tour.config.ts), never in CI. Needs the real card catalog locally.
 */

const OUT = "public/tour";
const STORE = { name: "Dragonfire Games", city: "Springfield", region: "IL", country: "USA", timezone: "America/Chicago" };

let storeId: string;
let label: string;

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  const { data, error } = await admin().from("stores").insert(STORE).select("id").single();
  if (error) throw error;
  storeId = data.id;
  // Two days ahead, so this week's event is upcoming.
  const weekday = (new Date().getUTCDay() + 2) % 7;
  label = `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday]} Armory`;
  const { error: slotError } = await admin()
    .from("store_schedules")
    .insert({ store_id: storeId, weekday, start_time: "18:30", label, weekly_format_poll: true });
  if (slotError) throw slotError;
});

test.afterAll(async () => {
  await admin().from("events").delete().eq("store_id", storeId);
  await admin().from("stores").delete().eq("id", storeId);
});

/** Screenshots the viewport, scrolled to the top or to just above `from`. */
async function shoot(page: Page, name: string, from?: Locator) {
  if (from) await from.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 76)); // below the sticky app bar
  else await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled", caret: "hide" });
}

async function cardId(name: string, color: string | null) {
  let q = admin().from("cards").select("id").eq("name", name);
  q = color ? q.eq("color", color) : q.is("color", null);
  const { data } = await q.maybeSingle();
  if (!data) throw new Error(`Card ${name} (${color}) not found. Run scripts/import-cards.mts first.`);
  return data.id;
}

test("capture the tour screenshots", async ({ newPlayer }) => {
  test.setTimeout(180_000);
  const [alex, sam, jordan, casey, riley, morgan] = await Promise.all(
    ["Alex", "Sam", "Jordan", "Casey", "Riley", "Morgan"].map((name) => newPlayer({ name })),
  );
  const players = [alex, sam, jordan, casey, riley, morgan];

  await admin().from("user_stores").insert(players.map((p) => ({ user_id: p.id, store_id: storeId })));
  await admin().from("store_owners").insert({ store_id: storeId, user_id: riley.id });

  const { data: events, error } = await alex.db.rpc("current_events_for_stores", { p_store_ids: [storeId] });
  if (error || !events?.[0]) throw error ?? new Error("no event");
  const eventId = events[0].id;
  for (const p of [riley, sam, alex, jordan, casey]) {
    const res = await p.db.rpc("attend_event", { p_event_id: eventId });
    if (res.error) throw res.error;
  }

  // Requests: player → [card, colour, quantity].
  const wants: [typeof alex, string, string | null, number][] = [
    [sam, "Snatch", "Red", 3],
    [sam, "Sink Below", "Red", 2],
    [jordan, "Command and Conquer", "Red", 1],
    [jordan, "Enlightened Strike", "Red", 2],
    [casey, "Pummel", "Red", 2],
    [alex, "Sink Below", "Blue", 2],
  ];
  for (const [p, name, color, quantity] of wants) {
    const res = await p.db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: await cardId(name, color), quantity }] });
    if (res.error) throw res.error;
  }
  const { data: requests } = await admin().from("requests").select("id, requester_id, card_id").eq("event_id", eventId);
  const requestOf = async (requester: typeof alex, name: string, color: string | null) => {
    const card = await cardId(name, color);
    return requests!.find((r) => r.requester_id === requester.id && r.card_id === card)!.id;
  };
  // Pledges: pledger → requester's card, quantity.
  const gives: [typeof alex, typeof alex, string, string | null, number][] = [
    [alex, sam, "Snatch", "Red", 2],
    [alex, jordan, "Command and Conquer", "Red", 1],
    [riley, sam, "Sink Below", "Red", 2],
    [jordan, alex, "Sink Below", "Blue", 1],
  ];
  for (const [pledger, requester, name, color, quantity] of gives) {
    const res = await pledger.db.rpc("pledge", { p_request_id: await requestOf(requester, name, color), p_quantity: quantity });
    if (res.error) throw res.error;
  }
  for (const [p, format] of [
    [sam, "cc"],
    [jordan, "cc"],
    [casey, "draft"],
  ] as const) {
    await p.db.rpc("vote_format", { p_event_id: eventId, p_format: format });
  }

  // Home: the next Armory and what to bring.
  await alex.page.goto("/");
  await expect(alex.page.getByText(label).first()).toBeVisible();
  await shoot(alex.page, "home");

  // The event with its format poll, then the requests with their coverage, and my checklist.
  const tabs = alex.page.getByRole("navigation", { name: "Event sections" });
  await openEvent(alex.page, eventId, "going");
  await shoot(alex.page, "event");
  await openEvent(alex.page, eventId, "requests");
  await shoot(alex.page, "requests", tabs);
  await openEvent(alex.page, eventId, "checklist");
  await shoot(alex.page, "checklist", tabs);

  // Notifications from the other players.
  await alex.page.goto("/notifications");
  await expect(alex.page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await shoot(alex.page, "notifications");

  // The store owner's dashboard.
  await riley.page.goto(`/manage/stores/${storeId}`);
  await expect(riley.page.getByText(label).first()).toBeVisible();
  await shoot(riley.page, "manage");
});
