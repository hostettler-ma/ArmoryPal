import Link from "next/link";
import { notFound } from "next/navigation";
import { MyStoreButton } from "@/components/my-store-button";
import { PageHeader } from "@/components/page-header";
import { activeSchedules, STORE_SELECT, type StoreWithSchedules } from "@/components/store-card";
import { isUuid, requireProfile } from "@/lib/auth";
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

  return (
    <main className="space-y-5">
      <PageHeader
        title={store.name}
        back="/"
        action={
          profile.is_admin && (
            <Link href={`/admin/stores/${store.id}`} className="text-sm font-medium text-accent">
              Edit
            </Link>
          )
        }
      />

      <div className="space-y-1">
        <p>{formatLocation(store)}</p>
        {store.address && <p className="text-sm text-muted">{store.address}</p>}
      </div>

      <MyStoreButton storeId={store.id} isMine={!!mine} wide />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Weekly events</h2>
        {schedules.length ? (
          <ul className="space-y-2">
            {schedules.map((s) => (
              <li key={s.id} className="card">
                <p className="font-semibold">{s.label}</p>
                <p className="text-sm text-muted">{formatSchedule(s)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card text-muted">This store has no Armory scheduled yet.</p>
        )}
        <p className="text-xs text-muted">
          Times are local to the store ({store.timezone.replaceAll("_", " ")}). This week&apos;s events and
          card requests arrive in Phase 3.
        </p>
      </section>
    </main>
  );
}
