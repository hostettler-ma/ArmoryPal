import Link from "next/link";
import { notFound } from "next/navigation";
import { EventCard } from "@/components/event-card";
import { MyStoreButton } from "@/components/my-store-button";
import { CancelOwnershipRequestButton, RequestOwnershipButton } from "@/components/ownership-buttons";
import { StoreNotes } from "@/components/store-notes";
import { PageHeader } from "@/components/page-header";
import { activeSchedules, STORE_SELECT, type StoreWithSchedules } from "@/components/store-card";
import { isUuid, requireProfile } from "@/lib/auth";
import { getCurrentEvents } from "@/lib/event-data";
import { ownershipState } from "@/lib/ownership";
import { formatLocation, formatSchedule } from "@/lib/stores";

export default async function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase, user, profile } = await requireProfile();

  const [{ data }, { data: mine }, { data: owners }, { data: pendingRequest }] = await Promise.all([
    supabase.from("stores").select(STORE_SELECT).eq("id", id).maybeSingle(),
    supabase.from("user_stores").select("store_id").eq("user_id", user.id).eq("store_id", id).maybeSingle(),
    supabase.from("store_owners").select("user_id, profile:profiles!store_owners_user_id_fkey(display_name)").eq("store_id", id),
    supabase
      .from("store_owner_requests")
      .select("id")
      .eq("store_id", id)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .maybeSingle(),
  ]);
  if (!data) notFound();
  const store = data as unknown as StoreWithSchedules;
  const schedules = activeSchedules(store);
  const archived = !!store.archived_at;
  const events = archived ? [] : ((await getCurrentEvents(supabase, [store.id], user.id)).get(store.id) ?? []);
  const ownership = ownershipState((owners ?? []).some((o) => o.user_id === user.id), !!pendingRequest);
  const ownerNames = (owners ?? []).map((o) => o.profile?.display_name).filter(Boolean);

  return (
    <main className="space-y-5">
      <PageHeader
        title={store.name}
        action={
          <>
            {!archived && (ownership === "owner" || profile.is_admin) && (
              <Link href={`/manage/stores/${store.id}`} className="text-sm font-medium text-accent-text">
                Manage
              </Link>
            )}
            {profile.is_admin && (
              <Link href={`/admin/stores/${store.id}`} className="text-sm font-medium text-accent-text">
                Edit
              </Link>
            )}
          </>
        }
      />

      <div className="space-y-1">
        <p>{formatLocation(store)}</p>
        {store.address && <p className="text-sm text-muted">{store.address}</p>}
        {ownerNames.length > 0 && <p className="text-sm text-muted">Run by {ownerNames.join(", ")}</p>}
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

      {!archived && ownership === "none" && <RequestOwnershipButton storeId={store.id} storeName={store.name} />}
      {!archived && ownership === "pending" && pendingRequest && (
        <div className="card flex items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-muted">Your request to manage this store is waiting for an admin.</p>
          <CancelOwnershipRequestButton requestId={pendingRequest.id} storeId={store.id} />
        </div>
      )}
    </main>
  );
}
