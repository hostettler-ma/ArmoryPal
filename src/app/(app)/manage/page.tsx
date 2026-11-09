import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StoreLink } from "@/components/store-link";
import { getOwnedStoreIds, requireProfile } from "@/lib/auth";
import { formatLocation } from "@/lib/stores";

/** The stores I manage. With just one, go straight to it. */
export default async function ManagePage() {
  const { supabase } = await requireProfile();
  const ids = await getOwnedStoreIds();
  if (ids.length === 0) notFound();
  if (ids.length === 1) redirect(`/manage/stores/${ids[0]}`);

  const { data: stores } = await supabase
    .from("stores")
    .select("id, name, city, region, country")
    .in("id", ids)
    .is("archived_at", null)
    .order("name");

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
