import { expect, test } from "@playwright/test";
import { expectAnonLockedOut } from "../support/lockdown";

// Read-only checks against the live site. Nothing here signs in or writes:
// only what any visitor's browser could already do.

test("login page loads and offers Discord", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const res = await page.goto("/login");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "ArmoryPal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Discord" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("protected pages redirect signed-out visitors to login", async ({ request }) => {
  for (const path of ["/", "/stores", "/me", "/notifications", "/admin"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect([302, 303, 307, 308], path).toContain(res.status());
    expect(res.headers()["location"], path).toMatch(/\/login(\?|$)/);
  }
});

test("PWA files are served", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const icons = ((await manifest.json()).icons as { src: string }[]).map((i) => i.src);
  for (const path of ["/sw.js", "/~offline", ...icons]) {
    expect((await request.get(path)).ok(), path).toBe(true);
  }
});

test("security headers and no secrets in the JavaScript", async ({ page }) => {
  const res = await page.goto("/login");
  const h = res!.headers();
  expect(h["strict-transport-security"], "HSTS").toBeTruthy();
  expect(h["x-frame-options"] ?? h["content-security-policy"] ?? "", "framing protection").toMatch(/DENY|SAMEORIGIN|frame-ancestors/i);
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-powered-by"]).toBeUndefined();

  const scripts = await page.locator("script[src]").evaluateAll((s) => s.map((e) => (e as HTMLScriptElement).src));
  for (const src of scripts) {
    const js = await (await page.request.get(src)).text();
    expect(js, `secret-looking key in ${src}`).not.toMatch(/sb_secret_[A-Za-z0-9_-]{10,}/);
  }
});

test("the production database API is closed to signed-out visitors", async () => {
  const url = process.env.PROD_SUPABASE_URL;
  const key = process.env.PROD_SUPABASE_PUBLISHABLE_KEY;
  test.skip(!url || !key, "set PROD_SUPABASE_URL and PROD_SUPABASE_PUBLISHABLE_KEY to check this");
  // Tables and views only: never POST functions at production.
  await expectAnonLockedOut(url!, key!, { callFunctions: false });
});
