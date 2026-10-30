import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
import { localEnv } from "./env";

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

export type Db = SupabaseClient<Database>;

let adminClient: Db | undefined;

/** Service-role client for setup, teardown and checking what really got stored. Bypasses RLS. */
export function admin(): Db {
  const env = localEnv();
  adminClient ??= createClient<Database>(env.url, env.secretKey, noSession);
  return adminClient;
}

/** A client with only the publishable key and no session, i.e. an anonymous visitor. */
export function anon(): Db {
  const env = localEnv();
  return createClient<Database>(env.url, env.publishableKey, noSession);
}

/** A client signed in with email + password. */
export async function signedIn(email: string, password: string): Promise<Db> {
  const env = localEnv();
  const client = createClient<Database>(env.url, env.publishableKey, noSession);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

/** This week's event at the E2E store (created lazily by the RPC, like the app does). */
export async function currentEventId(client: Db, storeId: string): Promise<string> {
  const { data, error } = await client.rpc("current_events_for_stores", { p_store_ids: [storeId] });
  if (error) throw error;
  if (!data?.length) throw new Error("The E2E store has no current event");
  return data[0].id;
}
