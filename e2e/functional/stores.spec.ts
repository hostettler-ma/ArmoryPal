import { expect, test } from "../support/fixtures";
import { E2E_STORE_ID, E2E_STORE_NAME } from "../support/env";
import { admin } from "../support/supabase";

test("find a store, add it to My stores, open it, remove it", async ({ newPlayer }) => {
  const { page, id } = await newPlayer();

  await page.goto("/");
  await page.getByRole("link", { name: "Find your store" }).click();
  await expect(page.getByRole("heading", { name: "Find a store" })).toBeVisible();

  // An empty search lists every store, including the seeded New York ones.
  await expect(page.locator("main li").first()).toBeVisible();
  expect(await page.locator("main > ul > li").count()).toBeGreaterThanOrEqual(10);

  const search = page.getByRole("searchbox", { name: "Search stores" });
  await search.fill("zzqx no such store");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No stores match “zzqx no such store”")).toBeVisible();

  // Typo-tolerant search finds the test store.
  await search.fill("E2E Tset Armory");
  await search.press("Enter");
  const result = page.locator("main li").filter({ hasText: E2E_STORE_NAME });
  await expect(result).toBeVisible();
  await result.getByRole("button", { name: "Add to My stores" }).click();
  await expect(result.getByRole("button", { name: "Remove from My stores" })).toBeVisible();

  // Home now shows the store with this week's event inside it.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My stores" })).toBeVisible();
  const thisWeek = page.getByRole("list", { name: `This week at ${E2E_STORE_NAME}` });
  await expect(thisWeek.getByRole("link")).toContainText("E2E Armory");
  await expect(thisWeek.getByRole("link")).toContainText(/\d+ going/);

  // Store page and its history.
  await page.getByRole("link", { name: new RegExp(E2E_STORE_NAME) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/stores/${E2E_STORE_ID}$`));
  await expect(page.getByRole("heading", { name: E2E_STORE_NAME })).toBeVisible();
  await expect(page.getByText("This week")).toBeVisible();
  await expect(page.getByText(/Every week: E2E Armory/)).toBeVisible();
  await page.getByRole("link", { name: "Past events" }).click();
  await expect(page.getByRole("heading", { name: "Past events" })).toBeVisible();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: E2E_STORE_NAME }).click();
  await expect(page).toHaveURL(new RegExp(`/stores/${E2E_STORE_ID}$`));

  // Removing from the store page goes back home.
  await page.getByRole("button", { name: "Remove from My stores" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Find your store" })).toBeVisible();

  const { count } = await admin().from("user_stores").select("*", { count: "exact", head: true }).eq("user_id", id);
  expect(count).toBe(0);
});

test("unknown or malformed store and event ids show a 404", async ({ newPlayer }) => {
  const { page } = await newPlayer();
  for (const path of [
    "/stores/00000000-0000-4000-a000-00000000dead",
    "/stores/not-a-uuid",
    "/events/00000000-0000-4000-a000-00000000dead",
    "/events/' or 1=1 --",
    "/stores/00000000-0000-4000-a000-00000000dead/history",
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
});

test("admins can create a store and add a weekly slot; others can't see admin", async ({ newPlayer }) => {
  const boss = await newPlayer({ name: "Admin Tester", isAdmin: true });
  const { page } = boss;
  const storeName = `E2E Admin Store ${Date.now()}`;

  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Admin", exact: true }).click();
  await page.getByRole("link", { name: "+ New store" }).click();

  // Required fields are enforced before anything is sent.
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page).toHaveURL(/\/admin\/stores\/new$/);

  await page.getByLabel("Store name").fill(storeName);
  await page.getByLabel("City").fill("Astoria");
  await page.getByLabel(/State \/ region/).fill("NY");
  await page.getByLabel("Country").fill("USA");
  await page.getByLabel("Time zone").selectOption("America/New_York");
  await page.getByLabel(/Notes/).fill("Bring sleeves");
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page).toHaveURL(/\/admin\/stores\/[0-9a-f-]{36}$/);
  const storeId = page.url().split("/").pop()!;

  await expect(page.getByText("No slots yet. Add one below.")).toBeVisible();
  await page.getByLabel("Day", { exact: true }).selectOption("2"); // Tuesday
  await page.getByLabel("Starts").fill("19:00");
  await page.getByLabel(/^Label/).fill("Tuesday Armory");
  await page.getByRole("button", { name: "Add slot" }).click();
  const slot = page.locator("li.card").filter({ hasText: "Tuesday Armory" });
  await expect(slot).toContainText("Tuesdays");
  await slot.getByRole("button", { name: "Deactivate" }).click();
  await expect(slot).toContainText("(inactive)");
  await slot.getByRole("button", { name: "Activate" }).click();
  await expect(slot).not.toContainText("(inactive)");

  // Editing store details: saving with a blank required field is blocked by the server too.
  await page.getByLabel("City").fill("   ");
  await page.getByRole("button", { name: "Save store" }).click();
  await expect(page.locator(".field-error").first()).toBeVisible();
  await page.getByLabel("City").fill("Astoria");
  await page.getByRole("button", { name: "Save store" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.getByRole("link", { name: "View" }).click();
  await expect(page.getByRole("heading", { name: storeName })).toBeVisible();
  await expect(page.getByText("Bring sleeves")).toBeVisible();
  await expect(page.getByText(/Every week: Tuesday Armory, Tuesdays/)).toBeVisible();

  // A regular player gets a 404, not an admin page.
  const regular = await newPlayer();
  expect((await regular.page.goto("/admin"))?.status()).toBe(404);
  expect((await regular.page.goto(`/admin/stores/${storeId}`))?.status()).toBe(404);
  expect((await regular.page.goto("/admin/stores/new"))?.status()).toBe(404);
  await regular.page.goto("/");
  await regular.page.getByRole("button", { name: "Menu" }).click();
  const menu = regular.page.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByRole("link", { name: "Find a store" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);

  // Viewing the store created this week's event; events block deleting schedules and stores.
  await admin().from("events").delete().eq("store_id", storeId);
  await admin().from("store_schedules").delete().eq("store_id", storeId);
  await admin().from("stores").delete().eq("id", storeId);
});
