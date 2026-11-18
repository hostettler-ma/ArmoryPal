import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
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

// Direct Postgres access for what no Supabase API can do in a test, like
// giving a user a Discord identity. Local only (same check as above).
const dbUrl = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
let pg: ReturnType<typeof postgres> | undefined;
export const db = () => (pg ??= postgres(dbUrl, { max: 2, onnotice: () => {} }));

/** Closes the direct connection; call in afterAll of files that used db(). */
export async function closeDb() {
  await pg?.end();
  pg = undefined;
}

/** A random Discord-style user ID (snowflake). */
export const snowflake = () => `1${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

/** Links a Discord account to the user, as `linkIdentity({ provider: 'discord' })` would. Returns the Discord ID. */
export async function linkDiscord(userId: string, discordId = snowflake()): Promise<string> {
  await db()`
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
    values (${discordId}, ${userId}, ${db().json({ sub: discordId, provider_id: discordId })}, 'discord', now(), now(), now())`;
  return discordId;
}

// A local ArmoryBot worker (if a developer set it up) would pick up the rows
// these tests queue and call Discord for their fake channels. Tests pause it;
// the pause expires on its own if a run crashes.
let pausedBefore: string | null = null;
export async function pauseDiscordWorker() {
  const [row] = await db()`select paused_until::text as p from public.discord_worker_state where id = 1`;
  pausedBefore = row?.p ?? null;
  await db()`update public.discord_worker_state set paused_until = greatest(paused_until, now() + interval '5 minutes') where id = 1`;
}
export async function resumeDiscordWorker() {
  await db()`update public.discord_worker_state set paused_until = ${pausedBefore}::timestamptz where id = 1`;
}
