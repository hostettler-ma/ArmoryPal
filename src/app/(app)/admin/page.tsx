import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { formatLocation } from "@/lib/stores";

export default async function AdminPage() {
  const { supabase } = await requireAdmin();
  const [{ data }, { count: pendingOwners }] = await Promise.all([
    supabase.from("stores").select("id, name, city, region, country, archived_at, store_schedules(count)").order("name"),
    supabase.from("store_owner_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  // Archived stores last.
  const stores = [...(data ?? [])].sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at));

  return (
    <main className="space-y-6">
      <PageHeader title="Admin" />

      <nav className="grid grid-cols-2 gap-2" aria-label="Admin sections">
        <Link href="/admin/players" className="card interactive block text-heading-02">
          Players
          <span className="block text-body-compact text-muted">Find, ban, unban</span>
        </Link>
        <Link href="/admin/log" className="card interactive block text-heading-02">
          Admin log
          <span className="block text-body-compact text-muted">Every admin action</span>
        </Link>
        <Link href="/admin/owners" className="card interactive block text-heading-02">
          Owner requests{pendingOwners ? ` (${pendingOwners})` : ""}
          <span className="block text-body-compact text-muted">Who may manage a store</span>
        </Link>
      </nav>

      <section className="space-y-3">
        <h2 className="text-heading-03">Stores</h2>
        <Link href="/admin/stores/new" className="btn btn-primary">
          + New store
        </Link>
        <ul className="space-y-2">
          {stores.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/stores/${s.id}`} className={`card interactive block ${s.archived_at ? "opacity-60" : ""}`}>
                <p className="text-heading-02">
                  {s.name}
                  {s.archived_at && (
                    <span className="ml-2 rounded-full border border-border px-2 text-helper text-muted">
                      Archived
                    </span>
                  )}
                </p>
                <p className="text-body-compact text-muted">
                  {formatLocation(s)} · {s.store_schedules[0]?.count ?? 0} slot(s)
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
