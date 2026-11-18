import { expect, test } from "../support/fixtures";
import { linkDiscordIdentity, removeEmailIdentity } from "../support/identities";
import { admin } from "../support/supabase";

// Connected accounts on /me and the Discord DM settings (docs/armorybot.md §8).
// Discord itself can't run in CI, so linked states are seeded in auth.identities.

const discordRow = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Connected accounts" }).getByRole("listitem").filter({ hasText: "Discord" });

test("without Discord: Connect on /me, and a nudge on the notification settings", async ({ newPlayer }) => {
  const { page } = await newPlayer();
  await page.goto("/me");
  const row = discordRow(page);
  await expect(row).toContainText("Not connected");
  await expect(row.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Disconnect" })).toHaveCount(0);

  await page.goto("/settings/notifications");
  const dms = page.getByRole("region", { name: "Discord DMs" });
  await dms.getByRole("link", { name: "Connect Discord to get DMs" }).click();
  await expect(page).toHaveURL(/\/me#connected-accounts$/);
});

test("with Discord and email: Discord can be disconnected", async ({ newPlayer }) => {
  const { page, id } = await newPlayer();
  await linkDiscordIdentity(id, undefined, "alice_fab");
  await page.goto("/me");
  const row = discordRow(page);
  await expect(row).toContainText("alice_fab");
  await expect(row.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);

  await row.getByRole("button", { name: "Disconnect" }).click();
  await expect(row).toContainText("Not connected");
  const { data } = await admin().auth.admin.getUserById(id);
  expect(data.user?.identities?.map((i) => i.provider)).toEqual(["email"]);
});

test("with only Discord: no Disconnect", async ({ newPlayer }) => {
  const { page, id } = await newPlayer();
  await linkDiscordIdentity(id);
  await removeEmailIdentity(id);
  await page.goto("/me");
  await expect(discordRow(page).getByRole("button", { name: "Disconnect" })).toHaveCount(0);
  await expect(page.getByText("Discord is your only way to sign in, so it can't be disconnected.")).toBeVisible();
});

test("a Discord account that already has its own ArmoryPal account gets a clear message", async ({ newPlayer }) => {
  const { page } = await newPlayer();
  // Supabase returns the failed link to our callback with an error code, no auth code.
  await page.goto("/auth/callback?error=server_error&error_code=identity_already_exists&next=%2Fme");
  await expect(page).toHaveURL(/\/me\?link_error=identity_already_exists$/);
  await expect(page.getByRole("region", { name: "Connected accounts" }).getByRole("alert")).toHaveText(
    "This Discord account already has its own ArmoryPal account. Sign in with Discord instead, or ask an admin to merge them.",
  );
});

test("Discord DMs are off by default and can be turned on per kind", async ({ newPlayer }) => {
  const { page, id } = await newPlayer();
  await linkDiscordIdentity(id);
  await page.goto("/settings/notifications");
  const dms = page.getByRole("region", { name: "Discord DMs" });
  const newRequests = dms.getByRole("switch", { name: "New requests" });
  await expect(newRequests).toHaveAttribute("aria-checked", "false");
  await expect(dms.getByRole("switch", { name: "Cards needed again" })).toHaveAttribute("aria-checked", "false");
  // The in-app switch for the same kind is separate and stays on.
  await expect(page.getByRole("switch", { name: "New requests" }).first()).toHaveAttribute("aria-checked", "true");

  await newRequests.click();
  await expect(newRequests).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(async () => (await admin().from("notification_preferences").select("kind, channel, enabled").eq("user_id", id)).data)
    .toEqual([{ kind: "new_requests", channel: "discord", enabled: true }]);

  await page.reload();
  await expect(dms.getByRole("switch", { name: "New requests" })).toHaveAttribute("aria-checked", "true");
});

test("a refused disconnect explains why and keeps Discord connected", async ({ newPlayer }) => {
  const { page, id } = await newPlayer();
  await linkDiscordIdentity(id);
  // Supabase refuses (e.g. it would leave no way to sign in, or manual linking is off on the server).
  await page.route("**/auth/v1/user/identities/**", (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ code: 422, error_code: "single_identity_not_deletable", msg: "User must have at least 1 identity" }),
    }),
  );
  await page.goto("/me");
  const region = page.getByRole("region", { name: "Connected accounts" });
  await discordRow(page).getByRole("button", { name: "Disconnect" }).click();
  await expect(region.getByRole("alert")).toHaveText("You need another way to sign in before you can disconnect Discord.");
  await expect(discordRow(page).getByRole("button", { name: "Disconnect" })).toBeEnabled();
});

test("explains when Discord wouldn't deliver a DM", async ({ newPlayer }) => {
  const { page, id } = await newPlayer();
  await linkDiscordIdentity(id);
  await admin().from("discord_dm_status").upsert({ user_id: id, undeliverable_at: new Date().toISOString(), error_code: 50278 });
  await page.goto("/settings/notifications");
  await expect(page.getByRole("region", { name: "Discord DMs" }).getByRole("status")).toHaveText(
    "ArmoryBot can only DM you while you're in a Discord server it's in. Join your store's server.",
  );
});
