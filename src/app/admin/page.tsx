import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { formatLocation } from "@/lib/stores";

export default async function AdminPage() {
  const { supabase } = await requireAdmin();
  const { data: stores } = await supabase
    .from("stores")
    .select("id, name, city, region, country, store_schedules(count)")
    .order("name");

  return (
    <main className="space-y-5">
      <PageHeader title="Admin · Stores" back="/" />
      <Link href="/admin/stores/new" className="btn btn-primary">
        + New store
      </Link>
      <ul className="space-y-2">
        {(stores ?? []).map((s) => (
          <li key={s.id}>
            <Link href={`/admin/stores/${s.id}`} className="card block">
              <p className="font-semibold">{s.name}</p>
              <p className="text-sm text-muted">
                {formatLocation(s)} · {s.store_schedules[0]?.count ?? 0} slot(s)
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
