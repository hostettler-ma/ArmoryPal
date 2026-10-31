import Link from "next/link";
import { notFound } from "next/navigation";
import { EventCard } from "@/components/event-card";
import { MyStoreButton } from "@/components/my-store-button";
import { StoreNotes } from "@/components/store-notes";
import { PageHeader } from "@/components/page-header";
import { activeSchedules, STORE_SELECT, type StoreWithSchedules } from "@/components/store-card";
import { isUuid, requireProfile } from "@/lib/auth";
import { getCurrentEvents } from "@/lib/event-data";
import { formatLocation, formatSchedule } from "@/lib/stores";

export default async function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase, user, profile } = await requireProfile();

  const [{ data }, { data: mine }] = await Promise.all([
    supabase.from("stores").select(STORE_SELECT).eq("id", id).maybeSingle(),
    supabase.from("user_stores").select("store_id").eq("user_id", user.id).eq("store_id", id).maybeSingle(),
  ]);
  if (!data) notFound();
  const store = data as unknown as StoreWithSchedules;
  const schedules = activeSchedules(store);
  const archived = !!store.archived_at;
  const events = archived ? [] : ((await getCurrentEvents(supabase, [store.id], user.id)).get(store.id) ?? []);

  return (
    <main className="space-y-5">
      <PageHeader
        title={store.name}
        action={
          profile.is_admin && (
            <Link href={`/admin/stores/${store.id}`} className="text-sm font-medium text-accent-text">
              Edit
            </Link>
          )
        }
      />

      <div className="space-y-1">
        <p>{formatLocation(store)}</p>
        {store.address && <p className="text-sm text-muted">{store.address}</p>}
      </div>

      {archived ? (
        <p className="card text-muted">
          This store is archived: it no longer runs Armory events on ArmoryPal. Its past events are still below.
        </p>
      ) : (
        <>
          <StoreNotes notes={store.notes} />
          <MyStoreButton storeId={store.id} isMine={!!mine} wide redirectOnRemove="/" />
        </>
      )}

      {!archived && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">This week</h2>
          {events.length ? (
            <ul className="space-y-2">
              {events.map((e) => (
                <li key={e.id}>
                  <EventCard event={e} timezone={store.timezone} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="card text-muted">This store has no Armory scheduled yet.</p>
          )}
          {schedules.length > 0 && (
            <p className="text-sm text-muted">Every week: {schedules.map((s) => `${s.label}, ${formatSchedule(s)}`).join(" · ")}</p>
          )}
          <p className="text-xs text-muted">Times are local to the store ({store.timezone.replaceAll("_", " ")}).</p>
        </section>
      )}

      <Link href={`/stores/${store.id}/history`} className="btn btn-secondary">
        Past events
      </Link>
    </main>
  );
}
