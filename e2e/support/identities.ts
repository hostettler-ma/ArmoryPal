import { randomInt } from "node:crypto";
import postgres from "postgres";
import { localEnv } from "./env";

/**
 * Direct Postgres access for seeding sign-in identities, which no Supabase API
 * can create without a real OAuth round-trip. Local stack only (localEnv()
 * refuses anything else).
 */
let sql: ReturnType<typeof postgres> | undefined;
function db() {
  localEnv();
  sql ??= postgres(process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", {
    max: 2,
    onnotice: () => {},
  });
  return sql;
}

export const discordSnowflake = () => `1${randomInt(1e9).toString().padStart(9, "0")}${randomInt(1e8).toString().padStart(8, "0")}`;

/** Gives the user a Discord identity, as connecting Discord on /me would. Returns the Discord ID. */
export async function linkDiscordIdentity(userId: string, discordId = discordSnowflake(), username = "e2e_discord"): Promise<string> {
  const data = { sub: discordId, provider_id: discordId, full_name: username, name: username };
  await db()`
    insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
    values (${discordId}, ${userId}, ${db().json(data)}, 'discord', now(), now(), now())`;
  return discordId;
}

/** Removes the user's email identity, leaving Discord as their only way to sign in. */
export async function removeEmailIdentity(userId: string) {
  await db()`delete from auth.identities where user_id = ${userId} and provider = 'email'`;
}
