"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/app/actions/admin";
import { isUuid, requireProfile } from "@/lib/auth";
import { MAX_EVENT_LABEL, parseEventLinks } from "@/lib/event-manage";
import { ruleMessage } from "@/lib/rules";
import { MAX_STORE_NOTES, parseScheduleInput } from "@/lib/stores";

// Thin wrappers around the owner RPCs (*_event_management.sql). The RPCs check
// that the caller manages the store (can_manage_store) and enforce every rule.

const text = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
};

function revalidateStore(storeId: string) {
  revalidatePath(`/manage/stores/${storeId}`);
  revalidatePath(`/stores/${storeId}`);
  revalidatePath("/");
}

function revalidateEvent(eventId: string, storeId: string) {
  revalidatePath(`/manage/events/${eventId}`);
  revalidatePath(`/events/${eventId}`);
  if (isUuid(storeId)) revalidateStore(storeId);
}

export async function saveEventLinks(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = text(formData, "eventId");
  if (!isUuid(eventId)) return { errors: { form: ruleMessage("event_not_found") } };
  const parsed = parseEventLinks({ gem: formData.get("gem"), ticket: formData.get("ticket") });
  if (!parsed.ok) return { errors: parsed.errors };
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("owner_update_event_links", {
    p_event_id: eventId,
    p_gem_url: parsed.value.gem_url ?? "",
    p_gem_code: parsed.value.gem_code ?? "",
    p_ticket_url: parsed.value.ticket_url ?? "",
  });
  if (error) return { errors: { form: ruleMessage(error.message) } };
  revalidateEvent(eventId, text(formData, "storeId"));
  return { saved: true };
}

export async function renameEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = text(formData, "eventId");
  if (!isUuid(eventId)) return { errors: { form: ruleMessage("event_not_found") } };
  const label = text(formData, "label");
  if (!label || label.length > MAX_EVENT_LABEL) return { errors: { label: ruleMessage("invalid_label") } };
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("owner_rename_event", { p_event_id: eventId, p_label: label });
  if (error) return { errors: { form: ruleMessage(error.message) } };
  revalidateEvent(eventId, text(formData, "storeId"));
  return { saved: true };
}

export async function moveEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const eventId = text(formData, "eventId");
  if (!isUuid(eventId)) return { errors: { form: ruleMessage("event_not_found") } };
  const date = text(formData, "date");
  const time = text(formData, "time");
  if (!date) return { errors: { date: "Pick a day." } };
  if (!time) return { errors: { time: "Pick a start time." } };
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("owner_move_event", { p_event_id: eventId, p_date: date, p_start_time: time });
  if (error) return { errors: { form: ruleMessage(error.message) } };
  revalidateEvent(eventId, text(formData, "storeId"));
  return { saved: true };
}

export async function createOneOffEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const storeId = text(formData, "storeId");
  if (!isUuid(storeId)) return { errors: { form: ruleMessage("store_not_found") } };
  const label = text(formData, "label");
  const date = text(formData, "date");
  const time = text(formData, "time");
  const errors: Record<string, string> = {};
  if (!label) errors.label = "Give the event a name.";
  if (!date) errors.date = "Pick a day.";
  if (!time) errors.time = "Pick a start time.";
  const links = parseEventLinks({ gem: formData.get("gem"), ticket: formData.get("ticket") });
  if (!links.ok) Object.assign(errors, links.errors);
  if (Object.keys(errors).length || !links.ok) return { errors };

  const { supabase } = await requireProfile();
  const { data: id, error } = await supabase.rpc("owner_create_event", {
    p_store_id: storeId,
    p_label: label,
    p_date: date,
    p_start_time: time,
    p_gem_url: links.value.gem_url ?? undefined,
    p_gem_code: links.value.gem_code ?? undefined,
    p_ticket_url: links.value.ticket_url ?? undefined,
  });
  if (error || !id) return { errors: { form: ruleMessage(error?.message) } };
  revalidateStore(storeId);
  redirect(`/manage/events/${id}`);
}

export async function addOwnerSchedule(_prev: FormState, formData: FormData): Promise<FormState> {
  const storeId = text(formData, "storeId");
  if (!isUuid(storeId)) return { errors: { form: ruleMessage("store_not_found") } };
  const parsed = parseScheduleInput(Object.fromEntries(formData.entries()));
  if (!parsed.ok) return { errors: parsed.errors };
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("owner_add_schedule", {
    p_store_id: storeId,
    p_label: parsed.value.label,
    p_weekday: parsed.value.weekday,
    p_start_time: parsed.value.start_time,
  });
  if (error) return { errors: { form: ruleMessage(error.message) } };
  revalidateStore(storeId);
  return { saved: true };
}

/** "Move all events": changes the weekly slot; open events follow (see owner_update_schedule). */
export async function updateOwnerSchedule(_prev: FormState, formData: FormData): Promise<FormState> {
  const storeId = text(formData, "storeId");
  const scheduleId = text(formData, "scheduleId");
  if (!isUuid(scheduleId)) return { errors: { form: ruleMessage("schedule_not_found") } };
  const parsed = parseScheduleInput(Object.fromEntries(formData.entries()));
  if (!parsed.ok) return { errors: parsed.errors };
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("owner_update_schedule", {
    p_schedule_id: scheduleId,
    p_label: parsed.value.label,
    p_weekday: parsed.value.weekday,
    p_start_time: parsed.value.start_time,
  });
  if (error) return { errors: { form: ruleMessage(error.message) } };
  if (isUuid(storeId)) revalidateStore(storeId);
  return { saved: true };
}

export async function setOwnerScheduleActive(formData: FormData) {
  const scheduleId = text(formData, "scheduleId");
  const storeId = text(formData, "storeId");
  if (!isUuid(scheduleId) || !isUuid(storeId)) return;
  const { supabase } = await requireProfile();
  await supabase.rpc("owner_set_schedule_active", {
    p_schedule_id: scheduleId,
    p_active: formData.get("active") === "true",
  });
  revalidateStore(storeId);
}

export async function saveStoreInfo(_prev: FormState, formData: FormData): Promise<FormState> {
  const storeId = text(formData, "storeId");
  if (!isUuid(storeId)) return { errors: { form: ruleMessage("store_not_found") } };
  const notes = text(formData, "notes");
  if (notes.length > MAX_STORE_NOTES) return { errors: { notes: ruleMessage("notes_too_long") } };
  const links = parseEventLinks({ ticket: formData.get("ticket") });
  if (!links.ok) return { errors: links.errors };
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("owner_update_store_info", {
    p_store_id: storeId,
    p_notes: notes,
    p_ticket_url: links.value.ticket_url ?? "",
  });
  if (error) return { errors: { form: ruleMessage(error.message) } };
  revalidateStore(storeId);
  return { saved: true };
}
