"use server";

import { notFound, redirect } from "next/navigation";
import { safeNext } from "@/lib/auth";
import { DEV_PASSWORD, devLoginEnabled, isDevUser } from "@/lib/dev-users";
import { createClient } from "@/lib/supabase/server";

/** Signs in as a seeded test player. Local `next dev` only; 404s anywhere else. */
export async function devSignIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  if (!devLoginEnabled() || !isDevUser(email)) notFound();

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: DEV_PASSWORD });
  if (error) redirect("/login?dev_error=1");
  redirect(safeNext(String(formData.get("next") ?? "/")));
}
