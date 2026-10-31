"use server";

import { canonicalDiscordAuthorizeUrl, isDiscordAuthorizeUrl, isSupabaseDiscordAuthorizeUrl } from "@/lib/discord-auth";
import { supabaseUrl } from "@/lib/supabase/env";

/**
 * Follows Supabase's Discord authorize URL one hop and returns the discord.com
 * URL it redirects to, so the login button can link there directly (which lets
 * phones open the Discord app). Returns null on anything unexpected; the button
 * then falls back to the normal redirect flow.
 */
export async function resolveDiscordAuthorizeUrl(url: string): Promise<string | null> {
  // Only our own Supabase authorize endpoint, so this can't fetch arbitrary URLs.
  if (!isSupabaseDiscordAuthorizeUrl(url, supabaseUrl)) return null;
  try {
    const res = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(5000) });
    const location = res.headers.get("location");
    return location && isDiscordAuthorizeUrl(location) ? canonicalDiscordAuthorizeUrl(location) : null;
  } catch {
    return null;
  }
}
