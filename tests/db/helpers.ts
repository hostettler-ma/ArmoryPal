import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

if (!url?.includes("127.0.0.1") && !url?.includes("localhost")) {
  throw new Error(`DB tests only run against local Supabase; got ${url}`);
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service-role client: bypasses RLS. Use only for setup/teardown. */
export const admin = createClient<Database>(url, secretKey, noSession);

export type TestUser = { id: string; email: string; client: SupabaseClient<Database> };

const created: string[] = [];

/** Creates a confirmed, onboarded user and returns a client signed in as them. */
export async function createTestUser(opts: { name?: string; isAdmin?: boolean } = {}): Promise<TestUser> {
  const email = `test-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  created.push(id);

  await admin
    .from("profiles")
    .update({ display_name: opts.name ?? "Tester", is_admin: opts.isAdmin ?? false })
    .eq("id", id);

  const client = createClient<Database>(url, publishableKey, noSession);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id, email, client };
}

/** Deletes every user created by createTestUser (cascades to their rows). */
export async function deleteTestUsers() {
  await Promise.all(created.splice(0).map((id) => admin.auth.admin.deleteUser(id)));
}
