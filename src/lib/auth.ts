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
    .select("id, display_name, gem_id, is_admin, guide_seen_at")
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

/** Ids of the stores the signed-in user owns (cached per request; the layout and pages share it). */
export const getOwnedStoreIds = cache(async (): Promise<string[]> => {
  const { supabase, user } = await requireProfile();
  const { data } = await supabase.from("store_owners").select("store_id").eq("user_id", user.id);
  return (data ?? []).map((r) => r.store_id);
});

/**
 * For owner pages: 404s unless the user owns this store or is an admin.
 * The owner RPCs check the same thing (can_manage_store); this only fails fast.
 */
export async function requireStoreManager(storeId: string) {
  const ctx = await requireProfile();
  if (!isUuid(storeId)) notFound();
  if (!ctx.profile.is_admin && !(await getOwnedStoreIds()).includes(storeId)) notFound();
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
