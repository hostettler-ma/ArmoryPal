"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid, safeNext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Adds or removes a store from the current user's "My stores" list. A
 * `redirectOnRemove` field (same-site path) navigates there after a removal.
 */
export async function setMyStore(formData: FormData) {
  const storeId = formData.get("storeId");
  const add = formData.get("add") === "true";
  if (!isUuid(storeId)) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (add) {
    // Ignore duplicates (double taps) rather than erroring.
    await supabase.from("user_stores").upsert({ user_id: user.id, store_id: storeId }, { ignoreDuplicates: true });
  } else {
    await supabase.from("user_stores").delete().eq("user_id", user.id).eq("store_id", storeId);
  }

  revalidatePath("/");
  revalidatePath("/stores");
  revalidatePath(`/stores/${storeId}`);

  const redirectOnRemove = formData.get("redirectOnRemove");
  if (!add && typeof redirectOnRemove === "string" && redirectOnRemove) redirect(safeNext(redirectOnRemove));
}
