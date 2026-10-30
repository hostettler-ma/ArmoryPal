import { expect, test } from "../support/fixtures";
import { E2E_STORE_ID } from "../support/env";
import { admin, currentEventId } from "../support/supabase";
import { attend, clickTab, openEvent, requestRow } from "../support/ui";

// Script payloads typed into every free-text field. If any of them runs, the
// fixture catches the alert() dialog (or the page error) and fails the test.
const NAME = `<img src=x onerror=alert(1)>`; // 28 chars, fits the 40-char name limit
const NOTE = `"><script>alert(2)</script><svg onload=alert(3)>`;
const STORE_NOTES = `<iframe src="javascript:alert(4)"></iframe>[x](javascript:alert(5))`;

test("script in names, notes and store notes is shown as text, never run", async ({ newPlayer }) => {
  const attacker = await newPlayer({ name: "Temp" });
  const victim = await newPlayer({ name: "Victim" });
  const boss = await newPlayer({ name: "Boss", isAdmin: true });
  const eventId = await currentEventId(victim.db, E2E_STORE_ID);

  // The attacker sets the payload as their display name through the real form.
  await attacker.page.goto("/me");
  await attacker.page.getByLabel("Display name").fill(NAME);
  await attacker.page.getByRole("button", { name: "Save" }).click();
  await expect(attacker.page.getByText("Saved.")).toBeVisible();

  // …attends, and requests a card with a payload note (through the UI too).
  await openEvent(attacker.page, eventId);
  await attend(attacker.page);
  await clickTab(attacker.page, /Requests/);
  await attacker.page.getByRole("button", { name: "+ Request cards" }).click();
  const add = attacker.page.getByRole("dialog", { name: "Request cards" });
  await add.getByRole("combobox").fill("Zeetest Sled");
  await add.getByRole("option", { name: /Zeetest Sledge/ }).click();
  await add.getByLabel(/Note/).fill(NOTE);
  await add.getByRole("button", { name: "Request 1 card" }).click();
  await expect(add).toBeHidden();

  // An admin puts a payload into the store notes.
  await boss.page.goto(`/admin/stores/${E2E_STORE_ID}`);
  const original = await boss.page.getByLabel(/Notes/).inputValue();
  await boss.page.getByLabel(/Notes/).fill(STORE_NOTES);
  await boss.page.getByRole("button", { name: "Save store" }).click();
  await expect(boss.page.getByText("Saved.")).toBeVisible();

  // The victim looks at every place those strings appear.
  await openEvent(victim.page, eventId);
  await attend(victim.page);
  await expect(victim.page.getByText(NAME)).toBeVisible(); // Going list
  await expect(victim.page.getByText(STORE_NOTES)).toBeVisible(); // store notes on the event
  await clickTab(victim.page, /Requests/);
  await expect(requestRow(victim.page, "Zeetest Sledge")).toContainText(NOTE);
  await requestRow(victim.page, "Zeetest Sledge").getByRole("button", { name: "I'll bring it" }).click();
  await expect(victim.page.getByRole("dialog", { name: "Bring this card" })).toContainText(`for ${NAME}`);
  await victim.page.keyboard.press("Escape");

  await victim.page.goto(`/stores/${E2E_STORE_ID}`);
  await expect(victim.page.getByText(STORE_NOTES)).toBeVisible();

  // The attacker's later request notifies the victim; the inbox renders the name.
  await attacker.db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "e2e-snatch-red", quantity: 1 }], p_note: NOTE });
  await victim.page.goto("/notifications");
  await expect(victim.page.getByText(NAME).first()).toBeVisible();

  // Nothing got turned into real elements.
  for (const page of [victim.page, attacker.page]) {
    expect(await page.locator("main img[src='x'], main iframe, main svg[onload], main script").count()).toBe(0);
  }

  await admin().from("stores").update({ notes: original || null }).eq("id", E2E_STORE_ID);
});

test("search boxes and URL parameters treat input as text", async ({ newPlayer }) => {
  const { page, db } = await newPlayer();

  // Reflected into the "No stores match" message.
  await page.goto(`/stores?q=${encodeURIComponent(`<script>alert(1)</script>`)}`);
  await expect(page.getByText("No stores match “<script>alert(1)</script>”")).toBeVisible();

  // SQL and LIKE wildcards in search are plain text, not query syntax.
  for (const q of [`' or 1=1 --`, `%`, `_`, `\\`, `'); drop table stores; --`]) {
    const { data, error } = await db.rpc("search_stores", { q });
    expect(error, q).toBeNull();
    expect(data?.length ?? 0, `search_stores(${q}) must not match everything`).toBeLessThan(5);
    const cards = await db.rpc("search_cards", { q, max_results: 15 });
    expect(cards.error, q).toBeNull();
  }
  expect((await admin().from("stores").select("id", { count: "exact", head: true })).count).toBeGreaterThan(5);

  // A huge query is cut down, not an error page.
  const res = await page.goto(`/stores?q=${"a".repeat(5000)}`);
  expect(res?.status()).toBeLessThan(400);
});

test("paste-list import copes with hostile input", async ({ newPlayer }) => {
  const { page, db } = await newPlayer();
  const eventId = await currentEventId(db, E2E_STORE_ID);
  await openEvent(page, eventId, "requests");
  await attend(page);
  await page.getByRole("button", { name: "+ Request cards" }).click();
  const add = page.getByRole("dialog", { name: "Request cards" });
  await add.getByRole("tab", { name: "Paste list" }).click();

  const lines = [
    "<script>alert(1)</script>",
    "99999999999999999999 Zeetest Snatch",
    "-5 Zeetest Snatch (Blue)",
    "' or 1=1 --",
    ...Array.from({ length: 300 }, (_, i) => `1 Card Number ${i}`), // more than the import limit
  ];
  await add.getByLabel("Card list").fill(lines.join("\n"));
  await add.getByRole("button", { name: "Check list" }).click();
  await expect(add.getByText(/Not found \/ not imported/)).toBeVisible();
  await expect(add.getByText("<script>alert(1)</script>").first()).toBeVisible();
  await expect(add.getByText(/Only the first \d+ cards are imported/).first()).toBeVisible();
  // Quantities are capped, never above 20.
  await expect(add.getByText(/^(2[1-9]|[3-9]\d|\d{3,})× /)).toHaveCount(0);
});
