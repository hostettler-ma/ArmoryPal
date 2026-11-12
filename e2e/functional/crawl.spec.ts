import { expect, test } from "../support/fixtures";
import { E2E_STORE_ID } from "../support/env";
import { admin, currentEventId } from "../support/supabase";

/**
 * Follows every in-app link reachable from Home (as a regular player and as an
 * admin) and checks each page loads: no error status, no uncaught errors, a
 * heading on screen. New pages get covered automatically once something links
 * to them.
 */
for (const role of ["player", "admin"] as const) {
  test(`every linked page loads (${role})`, async ({ newPlayer }) => {
    const me = await newPlayer({ isAdmin: role === "admin" });
    const { page } = me;

    // Give the crawl something to walk: a store on Home, attendance, a request, a notification.
    await admin().from("user_stores").insert({ user_id: me.id, store_id: E2E_STORE_ID });
    const eventId = await currentEventId(me.db, E2E_STORE_ID);
    await me.db.rpc("attend_event", { p_event_id: eventId });
    await me.db.rpc("add_requests", {
      p_event_id: eventId,
      p_items: [{ card_id: "e2e-sledge", quantity: 1 }],
      p_note: "crawl",
    });

    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      // Realtime reconnect noise isn't a bug; everything else logged as an error is.
      if (m.type() === "error" && !/websocket|realtime/i.test(m.text())) consoleErrors.push(`${page.url()}: ${m.text()}`);
    });

    const seen = new Set<string>();
    const knownDeadLinks = new Set<string>();
    const queue = ["/"];
    const skip = (path: string) => path.startsWith("/auth/") || path.startsWith("/login");

    while (queue.length && seen.size < 80) {
      const path = queue.shift()!;
      if (seen.has(path)) continue;
      seen.add(path);

      const res = await page.goto(path);
      // KNOWN BUG (see navigation.spec.ts): the admin log links to players whose account was deleted.
      const deletedPlayer = path.match(/^\/admin\/players\/([0-9a-f-]{36})$/)?.[1];
      if (res?.status() === 404 && deletedPlayer) {
        const { data } = await admin().from("profiles").select("id").eq("id", deletedPlayer).maybeSingle();
        if (!data) {
          knownDeadLinks.add(path);
          continue;
        }
      }
      expect(res?.status(), `status of ${path}`).toBeLessThan(400);
      await expect(page.locator("h1").first(), `heading on ${path}`).toBeVisible();

      const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      for (const href of hrefs) {
        const url = new URL(href);
        if (url.origin !== new URL(page.url()).origin) continue;
        const next = url.pathname + url.search;
        if (!seen.has(next) && !skip(url.pathname)) queue.push(next);
      }
    }

    const visited = [...seen];
    expect(visited.some((p) => p.startsWith("/events/")), "reached an event page").toBe(true);
    expect(visited.some((p) => p.includes("tab=checklist")), "reached the checklist tab").toBe(true);
    expect(visited).toEqual(expect.arrayContaining(["/", "/stores", "/me", "/notifications", "/settings/notifications"]));
    // Admins reach /manage through a store's "Manage" link and the breadcrumb; it lists every store for them.
    if (role === "admin") expect(visited).toEqual(expect.arrayContaining(["/admin", "/admin/stores/new", "/manage"]));
    // The browser also logs the known dead links' 404s; those are covered by the known-bug test.
    const isKnown = (e: string) => [...knownDeadLinks].some((p) => e.includes(p));
    expect(consoleErrors.filter((e) => !isKnown(e))).toEqual([]);
  });
}

test("PWA basics: manifest, icons, service worker, offline page", async ({ page }) => {
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const body = await manifest.json();
  expect(body.name).toMatch(/ArmoryPal/);
  for (const icon of body.icons as { src: string }[]) {
    expect((await page.request.get(icon.src)).ok(), icon.src).toBe(true);
  }
  expect((await page.request.get("/sw.js")).ok()).toBe(true);
  expect((await page.request.get("/apple-icon")).ok()).toBe(true);

  await page.goto("/~offline");
  await expect(page.locator("h1").first()).toBeVisible();
});
