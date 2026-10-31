import { expect } from "@playwright/test";
import { publicApiSurface } from "./api-surface";

/**
 * Checks that a signed-out visitor holding only the publishable key (which is
 * public: it ships in the app's JavaScript) can't read any table or view, and
 * optionally can't call any function. Returns what was checked.
 */
export async function expectAnonLockedOut(supabaseUrl: string, publishableKey: string, opts: { callFunctions: boolean }) {
  const surface = publicApiSurface();
  const headers = { apikey: publishableKey, "Content-Type": "application/json" };
  const open: string[] = [];

  for (const name of [...surface.tables, ...surface.views]) {
    const res = await fetch(`${supabaseUrl}/rest/v1/${name}?select=*&limit=1`, { headers });
    if (res.status < 400) open.push(`GET ${name} → ${res.status} ${(await res.text()).slice(0, 120)}`);
  }

  if (opts.callFunctions) {
    for (const fn of surface.functions) {
      const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn.name}`, { method: "POST", headers, body: JSON.stringify(fn.args) });
      const body = await res.text();
      // 401/403 = permission denied. Anything else means the call got past the permission check
      // (or the placeholder arguments didn't match, which is reported too so it's never silently skipped).
      if (res.status !== 401 && res.status !== 403) open.push(`POST rpc/${fn.name} → ${res.status} ${body.slice(0, 160)}`);
    }
  }

  expect(open, "endpoints a signed-out visitor can use").toEqual([]);
  return surface;
}
