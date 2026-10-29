import Link from "next/link";
import { notFound } from "next/navigation";
import { setScheduleActive } from "@/app/actions/admin";
import { ScheduleForm } from "@/components/admin/schedule-form";
import { StoreForm } from "@/components/admin/store-form";
import { PageHeader } from "@/components/page-header";
import { isUuid, requireAdmin } from "@/lib/auth";
import { formatSchedule } from "@/lib/stores";

export default async function EditStorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase } = await requireAdmin();

  const [{ data: store }, { data: schedules }] = await Promise.all([
    supabase.from("stores").select("*").eq("id", id).maybeSingle(),
    supabase.from("store_schedules").select("*").eq("store_id", id).order("weekday").order("start_time"),
  ]);
  if (!store) notFound();

  return (
    <main className="space-y-6">
      <PageHeader
        title={store.name}
        back="/admin"
        action={
          <Link href={`/stores/${store.id}`} className="text-sm font-medium text-accent-text">
            View
          </Link>
        }
      />

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
        <h2 className="text-lg font-semibold">Store details</h2>
        <StoreForm store={store} />
      </section>
    </main>
  );
}
