import { MyStoreButton } from "@/components/my-store-button";
import { PageHeader } from "@/components/page-header";
import { STORE_SELECT, StoreCard, type StoreWithSchedules } from "@/components/store-card";
import { requireProfile } from "@/lib/auth";

export default async function StoresPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { supabase, user } = await requireProfile();
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);

  const [{ data: stores, error }, { data: mine }] = await Promise.all([
    supabase.rpc("search_stores", { q }).select(STORE_SELECT),
    supabase.from("user_stores").select("store_id").eq("user_id", user.id),
  ]);
  const myIds = new Set((mine ?? []).map((m) => m.store_id));
  const results = (stores ?? []) as unknown as StoreWithSchedules[];

  return (
    <main className="space-y-6">
      <PageHeader title="Find a store" />

      <form role="search" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Store name or city"
          aria-label="Search stores"
          className="input"
          enterKeyHint="search"
        />
        <button className="btn btn-primary w-auto">Search</button>
      </form>

      {error ? (
        <p className="field-error">Search failed. Try again.</p>
      ) : results.length === 0 ? (
        <p className="card text-center text-muted">
          No stores match “{q}”. Ask an admin to add yours.
        </p>
      ) : (
        <ul className="space-y-3">
          {results.map((s) => (
            <li key={s.id}>
              <StoreCard store={s} trailing={<MyStoreButton storeId={s.id} isMine={myIds.has(s.id)} />} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
