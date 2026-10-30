import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "../../src/lib/supabase/database.types";
import { E2E_STORE_ID, localEnv } from "./env";
import { admin, currentEventId, signedIn } from "./supabase";

/**
 * Signs in exactly the way the app's own server does (@supabase/ssr) and
 * returns the auth cookies it would set. Putting these into a browser skips
 * Discord (which can't run in CI) without changing how the app reads sessions.
 */
export async function sessionCookies(email: string, password: string): Promise<{ name: string; value: string }[]> {
  const env = localEnv();
  const jar = new Map<string, string>();
  const ssr = createServerClient<Database>(env.url, env.publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach((c) => (c.value ? jar.set(c.name, c.value) : jar.delete(c.name))),
    },
  });
  const { error } = await ssr.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return [...jar].map(([name, value]) => ({ name, value }));
}

/**
 * For scanners and exploratory runs: a confirmed, onboarded user who follows
 * the E2E store, is going to this week's event and has one open request, so
 * every page has something on it.
 */
export async function makeActiveUser(name: string, opts: { isAdmin?: boolean } = {}) {
  const email = `${name.toLowerCase().replace(/\W+/g, "-")}-${randomUUID().slice(0, 6)}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  await admin().from("profiles").update({ display_name: name, is_admin: opts.isAdmin ?? false }).eq("id", id);
  await admin().from("user_stores").insert({ user_id: id, store_id: E2E_STORE_ID });

  const db = await signedIn(email, password);
  const eventId = await currentEventId(db, E2E_STORE_ID);
  await db.rpc("attend_event", { p_event_id: eventId });
  await db.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "e2e-snatch-red", quantity: 2 }], p_note: "" });
  return { id, email, password, eventId, cookies: await sessionCookies(email, password) };
}
