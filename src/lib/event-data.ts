import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { copySummary, type CopySummary, type PreviousRequest } from "./rollover";

export type EventSummary = Tables<"events"> & {
  label: string;
  attendeeCount: number;
  attending: boolean;
};

/**
 * This week's events for the given stores (created on demand), with attendee
 * counts and whether `userId` is attending. Grouped by store id.
 */
export async function getCurrentEvents(
  supabase: SupabaseClient<Database>,
  storeIds: string[],
  userId: string,
): Promise<Map<string, EventSummary[]>> {
  const byStore = new Map<string, EventSummary[]>();
  if (storeIds.length === 0) return byStore;

  const { data: events, error } = await supabase.rpc("current_events_for_stores", { p_store_ids: storeIds });
  if (error) throw error;
  if (!events?.length) return byStore;

  const eventIds = events.map((e) => e.id);
  const [{ data: attendances }, { data: schedules }] = await Promise.all([
    supabase.from("attendances").select("event_id, user_id").in("event_id", eventIds),
    supabase.from("store_schedules").select("id, label").in("id", events.map((e) => e.schedule_id)),
  ]);
  const labels = new Map((schedules ?? []).map((s) => [s.id, s.label]));

  for (const e of events) {
    const forEvent = (attendances ?? []).filter((a) => a.event_id === e.id);
    const summary: EventSummary = {
      ...e,
      label: labels.get(e.schedule_id) ?? "Armory",
      attendeeCount: forEvent.length,
      attending: forEvent.some((a) => a.user_id === userId),
    };
    byStore.set(e.store_id, [...(byStore.get(e.store_id) ?? []), summary]);
  }
  return byStore;
}

/**
 * Last week's event of the same weekly slot (the most recent ended one before
 * this event) and what the viewer could copy from it into this event.
 */
export async function getCopyCandidate(
  supabase: SupabaseClient<Database>,
  event: { id: string; schedule_id: string; event_date: string },
  userId: string,
): Promise<{ fromEventId: string; summary: CopySummary } | null> {
  const { data: previous } = await supabase
    .from("events")
    .select("id")
    .eq("schedule_id", event.schedule_id)
    .lt("event_date", event.event_date)
    .lte("ends_at", new Date().toISOString())
    .order("event_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!previous) return null;

  const [{ data: lastWeek }, { data: copied }] = await Promise.all([
    supabase
      .from("requests")
      .select("id, quantity, status, pledges(quantity)")
      .eq("event_id", previous.id)
      .eq("requester_id", userId)
      .eq("status", "active"),
    supabase
      .from("requests")
      .select("copied_from_id")
      .eq("event_id", event.id)
      .eq("requester_id", userId)
      .not("copied_from_id", "is", null),
  ]);

  const summary = copySummary(
    (lastWeek ?? []) as PreviousRequest[],
    new Set((copied ?? []).map((c) => c.copied_from_id!)),
  );
  return summary.requests > 0 ? { fromEventId: previous.id, summary } : null;
}
