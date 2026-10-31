import { randomUUID } from "node:crypto";
import { test as base, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookies } from "./auth-cookies";
import { admin, signedIn, type Db } from "./supabase";

export type Player = {
  id: string;
  email: string;
  password: string;
  name: string;
  /** A browser tab signed in as this player. */
  page: Page;
  context: BrowserContext;
  /** A Supabase client signed in as this player (for API-level checks). */
  db: Db;
};

type NewPlayer = (opts?: {
  name?: string | null;
  isAdmin?: boolean;
  /** false = leave the display name empty, so the app sends them to /welcome. */
  onboarded?: boolean;
}) => Promise<Player>;

type Fixtures = {
  /** Creates a throwaway user and a browser tab signed in as them. Cleaned up after the test. */
  newPlayer: NewPlayer;
  /** Page errors seen in any tab; a test fails if a page throws. */
  pageErrors: string[];
};

/** Short unique suffix so names from different tests never collide. */
export const uid = () => randomUUID().slice(0, 6);

/** A fresh browser context carrying a real app session for this user (see sessionCookies). */
async function signedInContext(browser: Browser, contextOptions: object, email: string, password: string) {
  const cookies = await sessionCookies(email, password);
  const context = await browser.newContext(contextOptions);
  const baseURL = (contextOptions as { baseURL?: string }).baseURL!;
  await context.addCookies(cookies.map((c) => ({ ...c, url: baseURL })));
  return context;
}

export const test = base.extend<Fixtures>({
  pageErrors: async ({}, provide) => {
    const errors: string[] = [];
    await provide(errors);
    expect(errors, "uncaught errors in the page").toEqual([]);
  },

  newPlayer: async ({ browser, pageErrors, baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor }, provide) => {
    const contextOptions = { baseURL, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor };
    const created: Player[] = [];

    await provide(async ({ name, isAdmin = false, onboarded = true } = {}) => {
      const email = `e2e-${randomUUID()}@example.com`;
      const password = `pw-${randomUUID()}`;
      const displayName = onboarded ? (name ?? `Player ${uid()}`) : "";

      const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      const id = data.user.id;
      const { error: profileError } = await admin()
        .from("profiles")
        .update({ display_name: displayName || null, is_admin: isAdmin })
        .eq("id", id);
      if (profileError) throw profileError;

      const context = await signedInContext(browser, contextOptions, email, password);
      const page = await context.newPage();
      page.on("pageerror", (e) => pageErrors.push(`${displayName || email}: ${e.message}`));
      // Any alert/confirm/prompt means injected script ran (the app itself never opens one).
      page.on("dialog", async (d) => {
        pageErrors.push(`${displayName || email}: unexpected ${d.type()} dialog "${d.message()}"`);
        await d.dismiss();
      });

      const player: Player = { id, email, password, name: displayName, page, context, db: await signedIn(email, password) };
      created.push(player);
      return player;
    });

    for (const p of created) {
      await p.context.close();
      await admin().auth.admin.deleteUser(p.id);
    }
  },
});

export { expect };
