import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";

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
