import { notFound } from "next/navigation";
import { ADMIN_LOG_SELECT, AdminLogList, type AdminLogRow } from "@/components/admin/admin-log-list";
import { BanButton, UnbanButton } from "@/components/admin/moderation-buttons";
import { PageHeader } from "@/components/page-header";
import { isUuid, requireAdmin } from "@/lib/auth";

export default async function AdminPlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase, user } = await requireAdmin();

  const nowIso = new Date().toISOString();
  const [{ data: profile }, { data: ban }, { data: upcoming }, { data: log }] = await Promise.all([
    supabase.from("profiles").select("id, display_name, gem_id, is_admin, created_at").eq("id", id).maybeSingle(),
    supabase
      .from("bans")
      .select("reason, created_at, by:profiles!bans_banned_by_fkey(display_name)")
      .eq("user_id", id)
      .maybeSingle(),
    supabase.from("attendances").select("event_id, events!inner(ends_at)").eq("user_id", id).gt("events.ends_at", nowIso),
    supabase
      .from("admin_actions")
      .select(ADMIN_LOG_SELECT)
      .eq("target_user", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (!profile) notFound();
  const name = profile.display_name ?? "This player";
  const openEvents = (upcoming ?? []).length;

  return (
    <main className="space-y-6">
      <PageHeader
        title={name}
        trail={[
          { label: "Admin", href: "/admin" },
          { label: "Players", href: "/admin/players" },
        ]}
      />

      <dl className="card grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Joined</dt>
        <dd>{new Date(profile.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}</dd>
        <dt className="text-muted">GEM ID</dt>
        <dd>{profile.gem_id ?? "none"}</dd>
        <dt className="text-muted">Upcoming events</dt>
        <dd>{openEvents}</dd>
        <dt className="text-muted">Role</dt>
        <dd>{profile.is_admin ? "Admin" : "Player"}</dd>
      </dl>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Moderation</h2>
        {ban ? (
          <>
            <div className="card space-y-1 border border-danger">
              <p className="font-semibold text-danger">Banned</p>
              <p>“{ban.reason}”</p>
              <p className="text-sm text-muted">
                by {(ban.by as { display_name: string | null } | null)?.display_name ?? "a former admin"} on{" "}
                {new Date(ban.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}
              </p>
            </div>
            <UnbanButton userId={profile.id} name={name} />
          </>
        ) : profile.id === user.id ? (
          <p className="card text-sm text-muted">This is you.</p>
        ) : profile.is_admin ? (
          <p className="card text-sm text-muted">
            Admins can&apos;t be banned. Revoke admin rights first (
            <code>npx tsx scripts/make-admin.mts &lt;email&gt; --revoke</code>).
          </p>
        ) : (
          <BanButton userId={profile.id} name={name} openEvents={openEvents} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">History</h2>
        <AdminLogList rows={(log ?? []) as unknown as AdminLogRow[]} />
      </section>
    </main>
  );
}
