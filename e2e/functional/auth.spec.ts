import { expect, test } from "../support/fixtures";
import { admin } from "../support/supabase";

test.describe("signing in", () => {
  test("signed-out visitors are sent to the login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "ArmoryPal" })).toBeVisible();
    // A link once the direct Discord URL is ready (so phones can open the Discord app), a button before.
    const discord = { name: "Continue with Discord" };
    await expect(page.getByRole("link", discord).or(page.getByRole("button", discord))).toBeVisible();
    // Google shows only where it's configured.
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(
      process.env.NEXT_PUBLIC_ENABLE_GOOGLE_LOGIN === "true" ? 1 : 0,
    );
    // Email sign-in stays hidden until magic links work (like production).
    await expect(page.getByLabel("Email")).toHaveCount(0);

    await page.goto("/stores");
    await expect(page).toHaveURL(/\/login\?next=%2Fstores$/);
  });

  test("onboarding: field validation, then Home", async ({ newPlayer }) => {
    // Magic links aren't in use yet, and Discord can't run in CI, so start from a
    // signed-in player who hasn't picked a display name.
    const { page, id } = await newPlayer({ onboarded: false });
    await page.goto("/");
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByRole("heading", { name: "Welcome to ArmoryPal" })).toBeVisible();

    const name = page.getByLabel("Display name");
    const gem = page.getByLabel(/GEM ID/);
    const save = page.getByRole("button", { name: "Continue" });

    // Only spaces: passes the browser's `required`, must be rejected by the server.
    await name.fill("   ");
    await save.click();
    await expect(page.getByText("Pick a display name.")).toBeVisible();

    // The input caps typing at 40 characters.
    await name.fill("x".repeat(60));
    await expect(name).toHaveValue("x".repeat(40));

    await name.fill("Onboarding Tester");
    await gem.fill("12ab34");
    await save.click();
    await expect(page.getByText("GEM IDs are numbers only.")).toBeVisible();

    // A rejected submit currently clears the form (see the known-bug test below), so type both again.
    await name.fill("Onboarding Tester");
    await gem.fill("1234 5678"); // spaces are stripped
    await save.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Onboarding Tester" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Find your store" })).toBeVisible();

    const { data: profile } = await admin().from("profiles").select("display_name, gem_id").eq("id", id).single();
    expect(profile).toEqual({ display_name: "Onboarding Tester", gem_id: "12345678" });
  });

  test("a broken sign-in link shows an error instead of signing in", async ({ page }) => {
    await page.goto("/auth/callback?code=not-a-real-code");
    await expect(page).toHaveURL(/\/login\?error=callback$/);
    await expect(page.getByText("That sign-in link didn't work")).toBeVisible();
  });
});

test.describe("known bugs", () => {
  // KNOWN BUG: after the server rejects the profile form, React 19 resets the
  // form's uncontrolled inputs, so everything the player typed is lost (a new
  // player's display name goes blank, so "Continue" is blocked until they
  // retype it). Fix: return the submitted values in ProfileFormState and use
  // them as defaultValue (src/components/profile-form.tsx).
  // test.fail() keeps the nightly run green while the bug exists, and turns it
  // red once fixed, as a reminder to delete this marker.
  test.fail("typed values survive a validation error on the profile form", async ({ newPlayer }) => {
    const { page } = await newPlayer({ name: "Keeps Typing" });
    await page.goto("/me");
    await page.getByLabel("Display name").fill("New Name");
    await page.getByLabel(/GEM ID/).fill("not-a-number");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("GEM IDs are numbers only.")).toBeVisible();
    await expect(page.getByLabel("Display name")).toHaveValue("New Name", { timeout: 3_000 });
    await expect(page.getByLabel(/GEM ID/)).toHaveValue("not-a-number", { timeout: 3_000 });
  });
});

test.describe("profile", () => {
  test("edit name and GEM ID, toggle notification settings, sign out", async ({ newPlayer }) => {
    const me = await newPlayer({ name: "Profile Tester" });
    const { page } = me;

    await page.goto("/");
    await page.getByRole("link", { name: "Profile Tester" }).click();
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(page.getByText(`Signed in as ${me.email}`)).toBeVisible();

    await page.getByLabel("Display name").fill("Renamed Tester");
    await page.getByLabel(/GEM ID/).fill("987654");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.getByRole("link", { name: "Back" }).click();
    await expect(page.getByRole("link", { name: "Renamed Tester" })).toBeVisible();

    // Notification settings: every switch flips and the change survives a reload.
    await page.goto("/settings/notifications");
    const switches = page.getByRole("switch");
    const count = await switches.count();
    expect(count).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < count; i++) await expect(switches.nth(i)).toHaveAttribute("aria-checked", "true");
    await switches.first().click();
    await expect(switches.first()).toHaveAttribute("aria-checked", "false");
    await expect(switches.first()).toBeEnabled(); // saved
    await page.reload();
    await expect(page.getByRole("switch").first()).toHaveAttribute("aria-checked", "false");
    await page.getByRole("switch").first().click();
    await expect(page.getByRole("switch").first()).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch").first()).toBeEnabled();

    await page.goto("/me");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/me");
    await expect(page).toHaveURL(/\/login\?next=%2Fme$/);
  });

  test("onboarding without mistakes goes straight to Home", async ({ newPlayer }) => {
    const { page, id } = await newPlayer({ onboarded: false });
    await page.goto("/");
    await expect(page).toHaveURL(/\/welcome$/);
    await page.getByLabel("Display name").fill("Fresh Player");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Fresh Player" })).toBeVisible();
    const { data } = await admin().from("profiles").select("display_name").eq("id", id).single();
    expect(data?.display_name).toBe("Fresh Player");
  });

  test("someone without a display name is sent to onboarding first", async ({ newPlayer }) => {
    const { page } = await newPlayer({ onboarded: false });
    for (const path of ["/", "/stores", "/me"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/welcome$/);
    }
  });
});
