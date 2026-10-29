"use server";

import { revalidatePath } from "next/cache";
import { NOTIFICATION_KINDS } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

/** Turns one notification kind on or off for the current user (RLS limits it to their own row). */
export async function setNotificationPreference(kind: string, enabled: boolean): Promise<{ error?: string }> {
  if (!NOTIFICATION_KINDS.some((k) => k.kind === kind)) return { error: "Unknown notification type." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const { error } = await supabase
    .from("notification_preferences")
    .upsert({ user_id: user.id, kind, enabled, updated_at: new Date().toISOString() });
  if (error) return { error: "Couldn't save. Try again." };

  revalidatePath("/settings/notifications");
  return {};
}
