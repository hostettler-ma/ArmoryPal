import { randomUUID } from "node:crypto";
import { expect, test } from "../support/fixtures";
import { admin } from "../support/supabase";
import { magicLinkFor } from "../support/mailpit";

const EVIL = ["//evil.example.com", "/\\evil.example.com", "https://evil.example.com", "/%2F%2Fevil.example.com", "javascript:alert(1)"];

test("after sign-in, ?next= can't send you to another site", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const email = `e2e-redirect-${randomUUID()}@example.com`;

  // Full magic-link round trip, starting from a login page with a hostile next.
  await page.goto(`/login?next=${encodeURIComponent("//evil.example.com/steal")}`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await page.goto(await magicLinkFor(email));
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).origin).toBe(origin);

  // Already signed in: /login?next=… redirects straight away; check each payload.
  for (const next of EVIL) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    expect(new URL(page.url()).origin, next).toBe(origin);
  }

  const { data } = await admin().auth.admin.listUsers({ perPage: 1000 });
  const id = data.users.find((u) => u.email === email)?.id;
  if (id) await admin().auth.admin.deleteUser(id);
});

test("the auth callback and the ?code= safety net stay on this site", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  for (const next of EVIL) {
    const res = await page.request.get(`/auth/callback?code=x&next=${encodeURIComponent(next)}`, { maxRedirects: 0 });
    expect(new URL(res.headers()["location"], origin).origin, next).toBe(origin);
  }
  // A login code on any page is forwarded to the callback on this origin, never elsewhere.
  for (const path of ["//evil.example.com/", "/%5Cevil.example.com"]) {
    const res = await page.request.get(`${origin}${path}?code=x`, { maxRedirects: 0 });
    if (res.status() >= 300 && res.status() < 400) {
      expect(new URL(res.headers()["location"], origin).origin, path).toBe(origin);
    }
  }
});

test("the onboarding form's hidden redirect can't be pointed elsewhere", async ({ newPlayer, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  for (const target of EVIL.slice(0, 3)) {
    const { page } = await newPlayer({ onboarded: false });
    await page.goto("/welcome");
    await page.locator('input[name="redirectTo"]').evaluate((el, v) => ((el as HTMLInputElement).value = v), target);
    await page.getByLabel("Display name").fill("Redirect Tester");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).origin, target).toBe(origin);
  }
});

test("security headers are set and nothing secret ships to the browser", async ({ page }) => {
  const res = await page.goto("/login");
  const h = res!.headers();

  // Can't be framed (clickjacking).
  expect(h["x-frame-options"] ?? h["content-security-policy"] ?? "", "framing protection").toMatch(/DENY|SAMEORIGIN|frame-ancestors/i);
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"], "referrer policy").toBeTruthy();
  expect(h["x-powered-by"], "X-Powered-By leaks the framework").toBeUndefined();

  // The secret key, or anything shaped like one, never appears in client JavaScript.
  const secret = process.env.SUPABASE_SECRET_KEY!;
  const scripts = await page.locator("script[src]").evaluateAll((s) => s.map((e) => (e as HTMLScriptElement).src));
  expect(scripts.length).toBeGreaterThan(0);
  for (const src of scripts) {
    const js = await (await page.request.get(src)).text();
    expect(js.includes(secret), `secret key in ${src}`).toBe(false);
    expect(js, `secret-looking key in ${src}`).not.toMatch(/sb_secret_[A-Za-z0-9_-]{10,}/);
  }

  // Source maps aren't published.
  const first = new URL(scripts[0]);
  expect((await page.request.get(`${first.pathname}.map`)).status()).toBeGreaterThanOrEqual(400);
});
