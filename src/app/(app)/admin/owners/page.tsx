import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DecideOwnershipButtons } from "@/components/ownership-buttons";
import { requireAdmin } from "@/lib/auth";
import { formatRelative } from "@/lib/notifications";

/** Pending store-ownership requests, oldest first. */
export default async function OwnerRequestsPage() {
  const { supabase } = await requireAdmin();
  const { data: requests } = await supabase
    .from("store_owner_requests")
    .select(
      "id, message, created_at, user_id, store:stores(id, name, city), player:profiles!store_owner_requests_user_id_fkey(display_name)",
    )
    .eq("status", "pending")
    .order("created_at");

  return (
    <main className="space-y-5">
      <PageHeader title="Owner requests" trail={[{ label: "Admin", href: "/admin" }]} />
      {!requests?.length ? (
        <p className="card text-muted">No requests waiting.</p>
      ) : (
        <ul className="space-y-2">
          {requests.map((r) => {
            const name = r.player?.display_name ?? "Unknown player";
            const store = r.store?.name ?? "a store";
            return (
              <li key={r.id} className="card space-y-2">
                <p>
                  <Link href={`/admin/players/${r.user_id}`} className="font-semibold text-accent-text">
                    {name}
                  </Link>{" "}
                  wants to manage{" "}
                  {r.store ? (
                    <Link href={`/admin/stores/${r.store.id}`} className="font-semibold text-accent-text">
                      {store}
                    </Link>
                  ) : (
                    store
                  )}
                  {r.store?.city && <span className="text-muted"> ({r.store.city})</span>}
                </p>
                {r.message && <p className="text-sm">“{r.message}”</p>}
                <p className="text-xs text-muted">{formatRelative(r.created_at)}</p>
                <DecideOwnershipButtons requestId={r.id} name={name} store={store} />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
