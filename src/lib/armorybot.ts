// ArmoryBot facts the app shows on the /discord-bot setup guide. The bot itself lives in
// supabase/functions (see docs/armorybot.md); nothing secret goes here.

/** Where the setup guide lives (public, so a server manager without an account can read it). */
export const ARMORYBOT_GUIDE_PATH = "/discord-bot";

/** View Channels (1<<10) + Send Messages (1<<11) + Embed Links (1<<14) + Read Message History (1<<16). */
export const ARMORYBOT_PERMISSIONS = (1 << 10) + (1 << 11) + (1 << 14) + (1 << 16);

/** Defaults of a new link; mirror discord_guild_stores in *_armorybot.sql. */
export const DEFAULT_DAYS_BEFORE = 2;
export const DEFAULT_POST_TIME = "10:00";

/**
 * The "Add to Discord" link for the bot (guild install with its four permissions), from the
 * public Discord application ID in NEXT_PUBLIC_DISCORD_CLIENT_ID. Null when it isn't set or
 * isn't a Discord ID, so the page can say so instead of linking to a broken URL.
 */
export function armoryBotInviteUrl(clientId: string | undefined): string | null {
  const id = clientId?.trim();
  if (!id || !/^\d{17,20}$/.test(id)) return null;
  const params = new URLSearchParams({
    client_id: id,
    scope: "bot applications.commands",
    permissions: String(ARMORYBOT_PERMISSIONS),
    integration_type: "0",
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}
