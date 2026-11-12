import { expect, test, uid } from "../support/fixtures";
import { E2E_STORE_ID } from "../support/env";
import { admin, currentEventId } from "../support/supabase";
import { attend, openEvent } from "../support/ui";

test("new accounts get the getting-started guide once; it's in the menu after that", async ({ newPlayer }) => {
  const { page, id } = await newPlayer({ guideSeen: false });
  await page.goto("/");
  const guide = page.getByRole("dialog", { name: "Getting started" });
  await expect(guide).toBeVisible();

  // Step through, then back, then skip.
  await guide.getByRole("button", { name: "Next" }).click();
  await guide.getByRole("button", { name: "Back" }).click();
  await guide.getByRole("button", { name: "Skip the guide" }).click();
  await expect(guide).toBeHidden();
  await expect.poll(async () => (await admin().from("profiles").select("guide_seen_at").eq("id", id).single()).data?.guide_seen_at).not.toBeNull();

  // Skipped means seen: no pop-up on the next visit.
  await page.reload();
  await expect(page.getByRole("heading", { name: "My stores" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Getting started" })).toHaveCount(0);

  // Still reachable from the menu.
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Getting started" }).click();
  await expect(page).toHaveURL(/\/guide$/);
  await expect(page.locator("h1").first()).toBeVisible();
});

test("the menu reaches every section and marks where you are", async ({ newPlayer }) => {
  const { page } = await newPlayer();
  await page.goto("/");
  for (const [label, path] of [
    ["Find a store", "/stores"],
    ["Notifications", "/notifications"],
    ["Profile", "/me"],
    ["Notification settings", "/settings/notifications"],
    ["Home", "/"],
  ] as const) {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await menu.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path.replace("/", "\\/")}$`));
    await expect(menu).toBeHidden(); // closes after navigating
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(menu.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await menu.getByRole("button", { name: "Close menu" }).click();
  }
  // The wordmark goes Home too.
  await page.goto("/me");
  await page.getByRole("link", { name: "ArmoryPal" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("privacy policy and terms are public", async ({ page }) => {
  for (const path of ["/privacy", "/terms"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${path}$`)); // not bounced to /login
    await expect(page.locator("h1").first()).toBeVisible();
  }
});

test("admin removes a player from an event; the player is told and can rejoin", async ({ newPlayer }) => {
  const boss = await newPlayer({ name: `Boss ${uid()}`, isAdmin: true });
  const player = await newPlayer({ name: `Player ${uid()}` });
  const eventId = await currentEventId(boss.db, E2E_STORE_ID);
  await player.db.rpc("attend_event", { p_event_id: eventId });

  await openEvent(boss.page, eventId);
  await attend(boss.page);
  const row = boss.page.locator("li", { hasText: player.name });
  await expect(boss.page.locator("li", { hasText: boss.name }).getByRole("button", { name: "Remove" })).toHaveCount(0); // not yourself
  await row.getByRole("button", { name: "Remove" }).click();
  const sheet = boss.page.getByRole("dialog", { name: `Remove ${player.name}?` });
  await sheet.getByLabel(/Reason/).fill("Testing removal");
  await sheet.getByRole("button", { name: "Remove from event" }).click();
  await expect(sheet).toBeHidden();
  await expect(boss.page.locator("li", { hasText: player.name })).toHaveCount(0);

  await player.page.goto("/notifications");
  await expect(player.page.getByText(/Testing removal/)).toBeVisible();
  await openEvent(player.page, eventId);
  await attend(player.page); // removal isn't a ban

  // The action is in the admin log.
  await boss.page.goto("/admin/log");
  await expect(boss.page.getByText(player.name).first()).toBeVisible();
});

test("admin bans a player: they only see the suspended page; unban restores access", async ({ newPlayer }) => {
  const boss = await newPlayer({ name: `Boss ${uid()}`, isAdmin: true });
  const player = await newPlayer({ name: `Banned ${uid()}` });

  await boss.page.goto(`/admin/players/${player.id}`);
  await boss.page.getByRole("button", { name: "Ban player" }).click();
  const sheet = boss.page.getByRole("dialog", { name: `Ban ${player.name}?` });
  await expect(sheet.getByRole("button", { name: "Ban" })).toBeDisabled(); // a reason is required
  await sheet.getByLabel(/Reason/).fill("Repeated no-shows");
  await sheet.getByRole("button", { name: "Ban" }).click();
  await expect(sheet).toBeHidden();

  for (const path of ["/", "/stores", "/me", `/stores/${E2E_STORE_ID}`]) {
    await player.page.goto(path);
    await expect(player.page).toHaveURL(/\/suspended$/);
  }
  await expect(player.page.getByRole("heading", { name: "Your account is suspended" })).toBeVisible();
  await expect(player.page.getByText("Repeated no-shows")).toBeVisible();

  await boss.page.reload();
  await boss.page.getByRole("button", { name: "Unban player" }).click();
  await boss.page.getByRole("dialog", { name: `Unban ${player.name}?` }).getByRole("button").last().click();
  await player.page.goto("/");
  await expect(player.page).toHaveURL(/\/$/);
});

// KNOWN BUG: admin_actions keeps target_user after the account is deleted (no FK, on purpose, so the
// log keeps its history), but the admin log still links that name to /admin/players/<id>, which 404s.
// Fix: render the label without a link when the player no longer exists (src/components/admin/admin-log-list.tsx).
// test.fail() keeps the nightly run green while the bug exists and turns red once it's fixed.
test.fail("the admin log doesn't link to players whose account was deleted", async ({ newPlayer }) => {
  const boss = await newPlayer({ name: `Boss ${uid()}`, isAdmin: true });
  const gone = await newPlayer({ name: `Gone ${uid()}` });
  const eventId = await currentEventId(boss.db, E2E_STORE_ID);
  await gone.db.rpc("attend_event", { p_event_id: eventId });
  expect((await boss.db.rpc("admin_remove_attendee", { p_event_id: eventId, p_user_id: gone.id })).error).toBeNull();
  await admin().auth.admin.deleteUser(gone.id);

  await boss.page.goto("/admin/log");
  const link = boss.page.getByRole("link", { name: gone.name });
  await expect(link).toHaveCount(0, { timeout: 3_000 });
});
