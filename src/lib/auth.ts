import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * For pages that need a signed-in, onboarded user. Redirects to /login or
 * /welcome otherwise. Returns the Supabase client so callers can reuse it.
 * Cached per request, so the (app) layout and the page share one lookup.
 */
export const requireProfile = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, gem_id, is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.display_name) redirect("/welcome");

  // Banned players only see the suspended page (the database blocks their writes regardless).
  const { data: ban } = await supabase.from("bans").select("user_id").eq("user_id", user.id).maybeSingle();
  if (ban) redirect("/suspended");

  return { supabase, user, profile: { ...profile, display_name: profile.display_name } };
});

/** Like requireProfile, but 404s for non-admins so the admin area stays hidden. */
export async function requireAdmin() {
  const ctx = await requireProfile();
  if (!ctx.profile.is_admin) notFound();
  return ctx;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params are user input; check the shape before handing them to Postgres. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Only allows same-site relative paths, to avoid open redirects via ?next=. */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(?![/\\])/.test(next) ? next : "/";
}
