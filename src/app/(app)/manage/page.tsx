import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StoreLink } from "@/components/store-link";
import { getOwnedStoreIds, requireProfile } from "@/lib/auth";
import { formatLocation } from "@/lib/stores";

/**
 * The stores I manage. With just one, go straight to it.
 * Admins can manage every store (same rule as requireStoreManager), so they see them all.
 */
export default async function ManagePage() {
  const { supabase, profile } = await requireProfile();

  let query = supabase.from("stores").select("id, name, city, region, country").is("archived_at", null);
  if (!profile.is_admin) {
    const ids = await getOwnedStoreIds();
    if (ids.length === 0) notFound();
    if (ids.length === 1) redirect(`/manage/stores/${ids[0]}`);
    query = query.in("id", ids);
  }
  const { data: stores } = await query.order("name");

  return (
    <main className="space-y-5">
      <PageHeader title="Manage my stores" />
      <ul className="space-y-2">
        {(stores ?? []).map((s) => (
          <li key={s.id}>
            <StoreLink store={s} subtitle={formatLocation(s)} href={`/manage/stores/${s.id}`} />
          </li>
        ))}
      </ul>
    </main>
  );
}
