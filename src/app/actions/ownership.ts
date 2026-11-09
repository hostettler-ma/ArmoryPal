"use server";

import { revalidatePath } from "next/cache";
import { isUuid, requireAdmin, requireProfile } from "@/lib/auth";
import { parseReason } from "@/lib/moderation";
import { parseOwnershipMessage } from "@/lib/ownership";
import { ruleMessage } from "@/lib/rules";

// Thin wrappers around the ownership RPCs (*_store_owners.sql), which enforce every rule.

export type OwnershipResult = { error?: string };

export async function requestOwnership(storeId: string, message: string): Promise<OwnershipResult> {
  if (!isUuid(storeId)) return { error: ruleMessage("store_not_found") };
  const parsed = parseOwnershipMessage(message);
  if (!parsed.ok) return { error: parsed.error };
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("request_store_ownership", {
    p_store_id: storeId,
    p_message: parsed.value || undefined,
  });
  if (error) return { error: ruleMessage(error.message) };
  revalidatePath(`/stores/${storeId}`);
  return {};
}

export async function cancelOwnershipRequest(requestId: string, storeId: string): Promise<OwnershipResult> {
  if (!isUuid(requestId)) return { error: ruleMessage("ownership_request_not_found") };
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("cancel_ownership_request", { p_request_id: requestId });
  if (error) return { error: ruleMessage(error.message) };
  if (isUuid(storeId)) revalidatePath(`/stores/${storeId}`);
  return {};
}

export async function decideOwnershipRequest(
  requestId: string,
  approve: boolean,
  note: string,
): Promise<OwnershipResult> {
  if (!isUuid(requestId)) return { error: ruleMessage("ownership_request_not_found") };
  const parsed = parseReason(note, { required: false });
  if (!parsed.ok) return { error: parsed.error };
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_decide_ownership_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_note: parsed.value || undefined,
  });
  if (error) return { error: ruleMessage(error.message) };
  revalidatePath("/admin/owners");
  revalidatePath("/admin");
  return {};
}

export async function removeStoreOwner(storeId: string, userId: string): Promise<OwnershipResult> {
  if (!isUuid(storeId) || !isUuid(userId)) return { error: ruleMessage("not_store_owner") };
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_remove_store_owner", { p_store_id: storeId, p_user_id: userId });
  if (error) return { error: ruleMessage(error.message) };
  revalidatePath(`/admin/stores/${storeId}`);
  revalidatePath(`/stores/${storeId}`);
  return {};
}
