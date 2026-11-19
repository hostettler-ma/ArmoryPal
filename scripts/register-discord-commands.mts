// Registers ArmoryBot's slash commands (supabase/functions/_shared/commands.ts) with Discord.
// Usage: npx tsx scripts/register-discord-commands.mts [--env supabase/functions/.env] [--guild <server id>]
//
// Reads DISCORD_APP_ID and DISCORD_BOT_TOKEN from supabase/functions/.env (or the --env file, or the
// environment). Bulk-overwrites the whole command set (PUT), so it's safe to re-run after changes.
// --guild registers on one server only, which applies instantly: use it with your dev app and test server.
// Without --guild, commands are global (all servers the bot is in).
import { config } from "dotenv";
import { COMMANDS } from "../supabase/functions/_shared/commands.ts";
import { DISCORD_API } from "../supabase/functions/_shared/discord-api.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

config({ path: arg("--env") ?? "supabase/functions/.env", quiet: true });

const appId = process.env.DISCORD_APP_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guild = arg("--guild");
if (!appId || !token) {
  console.error("Set DISCORD_APP_ID and DISCORD_BOT_TOKEN (see supabase/functions/.env.example).");
  process.exit(1);
}
if (guild !== undefined && !/^\d{1,20}$/.test(guild)) {
  console.error("--guild takes a server ID: turn on Developer Mode (User Settings → Advanced), then right-click the server → Copy Server ID.");
  process.exit(1);
}

if (guild === appId) {
  console.error("--guild got the app ID. Use the server's ID: turn on Developer Mode (User Settings → Advanced), then right-click the server → Copy Server ID.");
  process.exit(1);
}

const path = guild ? `/applications/${appId}/guilds/${guild}/commands` : `/applications/${appId}/commands`;
console.log(`Target: Discord app ${appId} (${guild ? `server ${guild}` : "global"})`);

const res = await fetch(`${DISCORD_API}${path}`, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(COMMANDS),
});
const body = await res.text();
if (!res.ok) {
  console.error(`Discord answered ${res.status}: ${body}`);
  process.exit(1);
}
const registered = JSON.parse(body) as { name: string; options?: { name: string }[] }[];
for (const c of registered) console.log(`Registered /${c.name}: ${(c.options ?? []).map((o) => o.name).join(", ")}`);
if (!guild) console.log("Global commands can take a few minutes to show up in Discord.");
