import { formatLocation, formatSchedule } from "@/lib/stores";
import type { Tables } from "@/lib/supabase/database.types";
import { StoreLink } from "./store-link";

/** PostgREST select that yields a StoreWithSchedules. */
export const STORE_SELECT = "*, store_schedules(id, weekday, start_time, active, label)";

export type StoreWithSchedules = Tables<"stores"> & {
  store_schedules: Pick<Tables<"store_schedules">, "id" | "weekday" | "start_time" | "active" | "label">[];
};

export function activeSchedules(store: StoreWithSchedules) {
  return store.store_schedules
    .filter((s) => s.active)
    .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
}

/** Store tile with location and weekly schedule, e.g. in search results. */
export function StoreCard({ store, trailing }: { store: StoreWithSchedules; trailing?: React.ReactNode }) {
  const schedules = activeSchedules(store);
  return (
    <StoreLink
      store={store}
      subtitle={formatLocation(store)}
      detail={schedules.length ? schedules.map(formatSchedule).join(" · ") : "No Armory scheduled"}
      trailing={trailing}
    />
  );
}
