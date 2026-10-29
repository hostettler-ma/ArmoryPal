"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid, requireAdmin } from "@/lib/auth";
import { parseScheduleInput, parseStoreInput } from "@/lib/stores";

// Authorization is enforced by RLS (public.is_admin()); requireAdmin() just
// fails fast with a 404 for non-admins.

export type FormState = { errors?: Record<string, string | undefined>; saved?: boolean };

const formFields = (formData: FormData) => Object.fromEntries(formData.entries());

export async function saveStore(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const parsed = parseStoreInput(formFields(formData));
  if (!parsed.ok) return { errors: parsed.errors };

  const storeId = formData.get("storeId");
  if (isUuid(storeId)) {
    const { error } = await supabase.from("stores").update(parsed.value).eq("id", storeId);
    if (error) return { errors: { form: `Couldn't save the store: ${error.message}` } };
    revalidatePath(`/stores/${storeId}`);
    revalidatePath(`/admin/stores/${storeId}`);
    return { saved: true };
  }

  const { data, error } = await supabase.from("stores").insert(parsed.value).select("id").single();
  if (error) return { errors: { form: `Couldn't create the store: ${error.message}` } };
  revalidatePath("/admin");
  redirect(`/admin/stores/${data.id}`);
}

export async function addSchedule(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const storeId = formData.get("storeId");
  if (!isUuid(storeId)) return { errors: { form: "Unknown store." } };
  const parsed = parseScheduleInput(formFields(formData));
  if (!parsed.ok) return { errors: parsed.errors };

  const { error } = await supabase.from("store_schedules").insert({ ...parsed.value, store_id: storeId });
  if (error) return { errors: { form: `Couldn't add the schedule: ${error.message}` } };
  revalidatePath(`/admin/stores/${storeId}`);
  revalidatePath(`/stores/${storeId}`);
  return { saved: true };
}

/** Schedules are deactivated rather than deleted so past events keep their history. */
export async function setScheduleActive(formData: FormData) {
  const { supabase } = await requireAdmin();
  const scheduleId = formData.get("scheduleId");
  const storeId = formData.get("storeId");
  if (!isUuid(scheduleId) || !isUuid(storeId)) return;

  await supabase
    .from("store_schedules")
    .update({ active: formData.get("active") === "true" })
    .eq("id", scheduleId);
  revalidatePath(`/admin/stores/${storeId}`);
  revalidatePath(`/stores/${storeId}`);
}
