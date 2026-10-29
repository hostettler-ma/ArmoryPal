import Link from "next/link";
import { STORE_SELECT, StoreCard, type StoreWithSchedules } from "@/components/store-card";
import { requireProfile } from "@/lib/auth";

export default async function HomePage() {
  const { supabase, user, profile } = await requireProfile();

  const { data } = await supabase
    .from("user_stores")
    .select(`created_at, store:stores(${STORE_SELECT})`)
    .eq("user_id", user.id)
    .order("created_at");
  const stores = (data ?? []).map((row) => row.store as unknown as StoreWithSchedules).filter(Boolean);

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">ArmoryPal</h1>
        <div className="flex items-center gap-2">
          {profile.is_admin && (
            <Link href="/admin" className="rounded-full px-3 py-2 text-sm font-medium text-muted">
              Admin
            </Link>
          )}
          <Link
            href="/me"
            className="flex h-10 min-w-10 items-center justify-center rounded-full bg-surface px-3 text-sm font-semibold ring-1 ring-border"
          >
            {profile.display_name}
          </Link>
        </div>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">My stores</h2>
          {stores.length > 0 && (
            <Link href="/stores" className="text-sm font-medium text-accent">
              Find stores
            </Link>
          )}
        </div>
        {stores.length ? (
          <ul className="space-y-3">
            {stores.map((s) => (
              <li key={s.id}>
                <StoreCard store={s} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="card space-y-3 text-center">
            <p className="text-muted">Add the store where you play Armory to see its weekly events.</p>
            <Link href="/stores" className="btn btn-primary">
              Find your store
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
