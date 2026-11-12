import { ADMIN_LOG_SELECT, AdminLogList, type AdminLogRow } from "@/components/admin/admin-log-list";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";

export default async function AdminLogPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase
    .from("admin_actions")
    .select(ADMIN_LOG_SELECT)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <main className="space-y-6">
      <PageHeader title="Admin log" trail={[{ label: "Admin", href: "/admin" }]} />
      <p className="text-body-compact text-muted">The last 100 bans, removals and store changes.</p>
      <AdminLogList rows={(data ?? []) as unknown as AdminLogRow[]} />
    </main>
  );
}
