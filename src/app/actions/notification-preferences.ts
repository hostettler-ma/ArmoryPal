"use server";

import { revalidatePath } from "next/cache";
import { DISCORD_DM_KINDS, NOTIFICATION_CHANNELS, NOTIFICATION_KINDS, type NotificationChannel } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

/** Turns one notification kind on or off, in-app or as a Discord DM, for the current user (RLS limits it to their own row). */
export async function setNotificationPreference(
  kind: string,
  enabled: boolean,
  channel: NotificationChannel = "app",
): Promise<{ error?: string }> {
  if (!NOTIFICATION_KINDS.some((k) => k.kind === kind)) return { error: "Unknown notification type." };
  if (!NOTIFICATION_CHANNELS.includes(channel)) return { error: "Unknown notification type." };
  if (channel === "discord" && !DISCORD_DM_KINDS.includes(kind)) return { error: "ArmoryBot doesn't send that as a DM." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const { error } = await supabase
    .from("notification_preferences")
    .upsert(
      { user_id: user.id, kind, channel, enabled, updated_at: new Date().toISOString() },
      { onConflict: "user_id,kind,channel" },
    );
  if (error) return { error: "Couldn't save. Try again." };

  revalidatePath("/settings/notifications");
  return {};
}
