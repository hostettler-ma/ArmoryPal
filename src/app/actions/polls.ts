"use server";

import { revalidatePath } from "next/cache";
import { isUuid, requireProfile } from "@/lib/auth";
import { isFormat, parsePollOptions } from "@/lib/formats";
import { ruleMessage } from "@/lib/rules";

// Thin wrappers around the poll RPCs (*_format_polls.sql), which enforce every rule.

export type PollResult = { error?: string };

function revalidateEvent(eventId: string, storeId?: string) {
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/manage/events/${eventId}`);
  if (storeId && isUuid(storeId)) revalidatePath(`/manage/stores/${storeId}`);
  revalidatePath("/");
}

export async function voteFormat(eventId: string, format: string | null): Promise<PollResult> {
  if (!isUuid(eventId)) return { error: ruleMessage("event_not_found") };
  if (format !== null && !isFormat(format)) return { error: ruleMessage("invalid_format") };
  const { supabase } = await requireProfile();
  const { error } =
    format === null
      ? await supabase.rpc("clear_format_vote", { p_event_id: eventId })
      : await supabase.rpc("vote_format", { p_event_id: eventId, p_format: format });
  if (error) return { error: ruleMessage(error.message) };
  revalidateEvent(eventId);
  return {};
}

export async function openPoll(eventId: string, options: string[]): Promise<PollResult> {
  if (!isUuid(eventId)) return { error: ruleMessage("event_not_found") };
  const parsed = parsePollOptions(options);
  if (!parsed.ok) return { error: parsed.error };
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("owner_open_poll", { p_event_id: eventId, p_options: parsed.value });
  if (error) return { error: ruleMessage(error.message) };
  revalidateEvent(eventId);
  return {};
}

export async function deletePoll(eventId: string): Promise<PollResult> {
  if (!isUuid(eventId)) return { error: ruleMessage("event_not_found") };
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("owner_delete_poll", { p_event_id: eventId });
  if (error) return { error: ruleMessage(error.message) };
  revalidateEvent(eventId);
  return {};
}

export async function confirmFormat(eventId: string, format: string): Promise<PollResult> {
  if (!isUuid(eventId)) return { error: ruleMessage("event_not_found") };
  if (!isFormat(format)) return { error: ruleMessage("invalid_format") };
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("owner_confirm_format", { p_event_id: eventId, p_format: format });
  if (error) return { error: ruleMessage(error.message) };
  revalidateEvent(eventId);
  return {};
}

export async function setWeeklyPoll(
  scheduleId: string,
  storeId: string,
  on: boolean,
  options: string[],
): Promise<PollResult> {
  if (!isUuid(scheduleId)) return { error: ruleMessage("schedule_not_found") };
  const parsed = parsePollOptions(options);
  if (!parsed.ok) return { error: parsed.error };
  const { supabase } = await requireProfile();
  const { error } = await supabase.rpc("owner_set_weekly_poll", {
    p_schedule_id: scheduleId,
    p_on: on,
    p_options: parsed.value,
  });
  if (error) return { error: ruleMessage(error.message) };
  if (isUuid(storeId)) revalidatePath(`/manage/stores/${storeId}`);
  return {};
}
