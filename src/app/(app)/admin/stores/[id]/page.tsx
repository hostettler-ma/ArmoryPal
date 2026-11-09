import Link from "next/link";
import { notFound } from "next/navigation";
import { setScheduleActive } from "@/app/actions/admin";
import { DeleteStoreButton, RestoreStoreButton } from "@/components/admin/moderation-buttons";
import { RemoveOwnerButton } from "@/components/ownership-buttons";
import { ScheduleForm } from "@/components/admin/schedule-form";
import { StoreForm } from "@/components/admin/store-form";
import { PageHeader } from "@/components/page-header";
import { isUuid, requireAdmin } from "@/lib/auth";
import { formatSchedule } from "@/lib/stores";

export default async function EditStorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase } = await requireAdmin();

  const [{ data: store }, { data: schedules }, { count: eventCount }, { data: owners }] = await Promise.all([
    supabase.from("stores").select("*").eq("id", id).maybeSingle(),
    supabase.from("store_schedules").select("*").eq("store_id", id).order("weekday").order("start_time"),
    supabase.from("events").select("id", { count: "exact", head: true }).eq("store_id", id),
    supabase
      .from("store_owners")
      .select("user_id, created_at, profile:profiles!store_owners_user_id_fkey(display_name)")
      .eq("store_id", id)
      .order("created_at"),
  ]);
  if (!store) notFound();

  return (
    <main className="space-y-6">
      <PageHeader
        title={store.name}
        trail={[{ label: "Admin", href: "/admin" }]}
        action={
          <Link href={`/stores/${store.id}`} className="text-sm font-medium text-accent-text">
            View
          </Link>
        }
      />

      {store.archived_at && (
        <div className="card space-y-3 border border-border">
          <p>
            <span className="font-semibold">Archived.</span>{" "}
            <span className="text-muted">
              Hidden from search and Home since{" "}
              {new Date(store.archived_at).toLocaleDateString("en-US", { dateStyle: "medium" })}. Past events are kept.
            </span>
          </p>
          <RestoreStoreButton storeId={store.id} />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Weekly slots</h2>
        {(schedules ?? []).length === 0 && <p className="text-muted">No slots yet. Add one below.</p>}
        <ul className="space-y-2">
          {(schedules ?? []).map((s) => (
            <li key={s.id} className={`card flex items-center gap-3 ${s.active ? "" : "opacity-60"}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {s.label} {!s.active && <span className="text-sm font-normal text-muted">(inactive)</span>}
                </p>
                <p className="text-sm text-muted">{formatSchedule(s)}</p>
              </div>
              <form action={setScheduleActive}>
                <input type="hidden" name="scheduleId" value={s.id} />
                <input type="hidden" name="storeId" value={store.id} />
                <input type="hidden" name="active" value={String(!s.active)} />
                <button className="btn btn-secondary !min-h-10 !w-auto px-3 text-sm">
                  {s.active ? "Deactivate" : "Activate"}
                </button>
              </form>
            </li>
          ))}
        </ul>
        <ScheduleForm storeId={store.id} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Owners</h2>
        {(owners ?? []).length === 0 ? (
          <p className="text-muted">
            No owners yet. Players ask from the store page; requests show up in{" "}
            <Link href="/admin/owners" className="text-accent-text">
              Owner requests
            </Link>
            .
          </p>
        ) : (
          <ul className="card divide-y divide-border !py-0">
            {(owners ?? []).map((o) => {
              const name = o.profile?.display_name ?? "Unknown player";
              return (
                <li key={o.user_id} className="flex min-h-12 items-center gap-3 py-2">
                  <Link href={`/admin/players/${o.user_id}`} className="min-w-0 flex-1 truncate text-accent-text">
                    {name}
                  </Link>
                  <RemoveOwnerButton storeId={store.id} userId={o.user_id} name={name} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Store details</h2>
        <StoreForm store={store} />
      </section>

      {!store.archived_at && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-danger">Danger zone</h2>
          <DeleteStoreButton storeId={store.id} name={store.name} eventCount={eventCount ?? 0} />
        </section>
      )}
    </main>
  );
}
