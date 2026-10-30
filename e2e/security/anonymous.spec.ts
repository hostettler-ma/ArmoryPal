import { expect, test } from "../support/fixtures";
import { E2E_STORE_ID, localEnv } from "../support/env";
import { expectAnonLockedOut } from "../support/lockdown";

const PROTECTED_PAGES = [
  "/",
  "/stores",
  `/stores/${E2E_STORE_ID}`,
  `/stores/${E2E_STORE_ID}/history`,
  "/events/00000000-0000-4000-a000-000000000000",
  "/me",
  "/welcome",
  "/notifications",
  "/settings/notifications",
  "/admin",
  "/admin/stores/new",
];

test("every page except login needs a session", async ({ page }) => {
  for (const path of PROTECTED_PAGES) {
    const res = await page.request.get(path, { maxRedirects: 0 });
    expect([302, 303, 307, 308], `${path} should redirect`).toContain(res.status());
    expect(res.headers()["location"], path).toMatch(/\/login(\?|$)/);
  }
});

test("the database API is closed to signed-out visitors (production grants)", async () => {
  const env = localEnv();
  const surface = await expectAnonLockedOut(env.url, env.publishableKey, { callFunctions: true });

  // Positive control: the same requests with the secret key succeed, so the checks above are real.
  for (const table of surface.tables) {
    const res = await fetch(`${env.url}/rest/v1/${table}?select=*&limit=1`, { headers: { apikey: env.secretKey } });
    expect(res.status, `service role can read ${table}`).toBe(200);
  }
});

test("auth API: anonymous sign-in is off", async () => {
  const env = localEnv();
  const headers = { apikey: env.publishableKey, "Content-Type": "application/json" };
  const anonymous = await fetch(`${env.url}/auth/v1/signup`, { method: "POST", headers, body: "{}" });
  expect(anonymous.status, "anonymous sign-ins").toBeGreaterThanOrEqual(400);
});
