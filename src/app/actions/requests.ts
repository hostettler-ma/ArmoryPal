"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/auth";
import { ruleMessage } from "@/lib/rules";
import { createClient } from "@/lib/supabase/server";

// Thin wrappers around the request/pledge RPCs, which enforce every rule.
// Each returns { error } with a friendly message, or {} on success.

export type ActionResult = { error?: string };

async function run(eventId: string, call: (supabase: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ error: { message: string } | null }>): Promise<ActionResult> {
  if (!isUuid(eventId)) return { error: ruleMessage("event_not_found") };
  const supabase = await createClient();
  const { error } = await call(supabase);
  if (error) return { error: ruleMessage(error.message) };
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/");
  return {};
}

export async function addRequests(
  eventId: string,
  items: { cardId: string; quantity: number }[],
  note: string,
): Promise<ActionResult> {
  return run(eventId, (s) =>
    s.rpc("add_requests", {
      p_event_id: eventId,
      p_items: items.map((i) => ({ card_id: i.cardId, quantity: i.quantity })),
      p_note: note,
    }),
  );
}

export async function updateRequest(eventId: string, requestId: string, quantity: number, note: string): Promise<ActionResult> {
  if (!isUuid(requestId)) return { error: ruleMessage("request_not_found") };
  return run(eventId, (s) => s.rpc("update_request", { p_request_id: requestId, p_quantity: quantity, p_note: note }));
}

export async function cancelRequest(eventId: string, requestId: string): Promise<ActionResult> {
  if (!isUuid(requestId)) return { error: ruleMessage("request_not_found") };
  return run(eventId, (s) => s.rpc("cancel_request", { p_request_id: requestId }));
}

export async function pledge(eventId: string, requestId: string, quantity: number): Promise<ActionResult> {
  if (!isUuid(requestId)) return { error: ruleMessage("request_not_found") };
  return run(eventId, (s) => s.rpc("pledge", { p_request_id: requestId, p_quantity: quantity }));
}

export async function unpledge(eventId: string, requestId: string): Promise<ActionResult> {
  if (!isUuid(requestId)) return { error: ruleMessage("request_not_found") };
  return run(eventId, (s) => s.rpc("unpledge", { p_request_id: requestId }));
}
