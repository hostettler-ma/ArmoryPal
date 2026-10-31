"use server";

import { revalidatePath } from "next/cache";
import { isUuid, requireAdmin } from "@/lib/auth";
import { parseReason } from "@/lib/moderation";
import { ruleMessage } from "@/lib/rules";

// Thin wrappers around the admin RPCs (*_admin_moderation.sql), which enforce
// every rule and write the admin log. requireAdmin() only fails fast.

export type ModerationResult = { error?: string; outcome?: "archived" | "deleted" };

export async function removeAttendee(eventId: string, userId: string, reason: string): Promise<ModerationResult> {
  if (!isUuid(eventId) || !isUuid(userId)) return { error: ruleMessage("event_not_found") };
  const parsed = parseReason(reason, { required: false });
  if (!parsed.ok) return { error: parsed.error };
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_remove_attendee", {
    p_event_id: eventId,
    p_user_id: userId,
    p_reason: parsed.value || undefined,
  });
  if (error) return { error: ruleMessage(error.message) };
  revalidatePath(`/events/${eventId}`);
  return {};
}

export async function banPlayer(userId: string, reason: string): Promise<ModerationResult> {
  if (!isUuid(userId)) return { error: ruleMessage("user_not_found") };
  const parsed = parseReason(reason, { required: true });
  if (!parsed.ok) return { error: parsed.error };
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_ban", { p_user_id: userId, p_reason: parsed.value });
  if (error) return { error: ruleMessage(error.message) };
  revalidatePath(`/admin/players/${userId}`);
  revalidatePath("/admin/players");
  return {};
}

export async function unbanPlayer(userId: string): Promise<ModerationResult> {
  if (!isUuid(userId)) return { error: ruleMessage("user_not_found") };
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_unban", { p_user_id: userId });
  if (error) return { error: ruleMessage(error.message) };
  revalidatePath(`/admin/players/${userId}`);
  revalidatePath("/admin/players");
  return {};
}

export async function deleteStore(storeId: string): Promise<ModerationResult> {
  if (!isUuid(storeId)) return { error: ruleMessage("store_not_found") };
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("admin_delete_store", { p_store_id: storeId });
  if (error) return { error: ruleMessage(error.message) };
  revalidatePath("/admin");
  revalidatePath(`/admin/stores/${storeId}`);
  revalidatePath(`/stores/${storeId}`);
  revalidatePath("/");
  return { outcome: data === "deleted" ? "deleted" : "archived" };
}

export async function restoreStore(storeId: string): Promise<ModerationResult> {
  if (!isUuid(storeId)) return { error: ruleMessage("store_not_found") };
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_restore_store", { p_store_id: storeId });
  if (error) return { error: ruleMessage(error.message) };
  revalidatePath("/admin");
  revalidatePath(`/admin/stores/${storeId}`);
  revalidatePath(`/stores/${storeId}`);
  return {};
}
