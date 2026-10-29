import Link from "next/link";
import { formatLocation, formatSchedule } from "@/lib/stores";
import type { Tables } from "@/lib/supabase/database.types";

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

export function StoreCard({ store, trailing }: { store: StoreWithSchedules; trailing?: React.ReactNode }) {
  const schedules = activeSchedules(store);
  return (
    <div className="card flex items-center gap-3">
      <Link href={`/stores/${store.id}`} className="min-w-0 flex-1">
        <p className="truncate font-semibold">{store.name}</p>
        <p className="truncate text-sm text-muted">{formatLocation(store)}</p>
        <p className="mt-1 truncate text-sm">
          {schedules.length ? schedules.map(formatSchedule).join(" · ") : "No Armory scheduled"}
        </p>
      </Link>
      {trailing}
    </div>
  );
}
