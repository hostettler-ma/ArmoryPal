/**
 * Discord sign-in through the phone app. Phones only hand a link to the Discord
 * app when the user taps a discord.com link directly, not after Supabase's
 * redirect, so the login page resolves the real authorize URL up front and
 * renders it as a plain link. These checks keep that resolution safe.
 */

/** Discord's flow state in Supabase Auth expires; re-resolve links older than this. */
export const DISCORD_LINK_MAX_AGE_MS = 4 * 60 * 1000;

/** Our own Supabase `/auth/v1/authorize?provider=discord…` URL, and nothing else. */
export function isSupabaseDiscordAuthorizeUrl(url: string, supabaseUrl: string): boolean {
  try {
    const u = new URL(url);
    const base = new URL(supabaseUrl);
    return (
      u.origin === base.origin &&
      u.pathname === `${base.pathname.replace(/\/$/, "")}/auth/v1/authorize` &&
      u.searchParams.get("provider") === "discord"
    );
  } catch {
    return false;
  }
}

/** Discord's own OAuth authorize page over https. */
export function isDiscordAuthorizeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname === "discord.com" &&
      (u.pathname === "/oauth2/authorize" || u.pathname === "/api/oauth2/authorize")
    );
  } catch {
    return false;
  }
}

/**
 * Supabase sends players to `/api/oauth2/authorize`; Discord documents (and its
 * apps are likelier to claim) `/oauth2/authorize`, which takes the same query.
 */
export function canonicalDiscordAuthorizeUrl(url: string): string {
  const u = new URL(url);
  if (u.pathname === "/api/oauth2/authorize") u.pathname = "/oauth2/authorize";
  return u.toString();
}
