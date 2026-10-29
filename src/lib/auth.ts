import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * For pages that need a signed-in, onboarded user. Redirects to /login or
 * /welcome otherwise. Returns the Supabase client so callers can reuse it.
 */
export async function requireProfile() {
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

  return { supabase, user, profile: { ...profile, display_name: profile.display_name } };
}

/** Only allows same-site relative paths, to avoid open redirects via ?next=. */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(?![/\\])/.test(next) ? next : "/";
}
