import Link from "next/link";
import { ADMIN_ACTION_LABELS } from "@/lib/moderation";
import { formatRelative } from "@/lib/notifications";

export type AdminLogRow = {
  id: number;
  action: string;
  target_user: string | null;
  target_store: string | null;
  target_event: string | null;
  target_label: string | null;
  detail: string | null;
  created_at: string;
  admin: { display_name: string | null } | null;
};

/** Select string for AdminLogRow. */
export const ADMIN_LOG_SELECT =
  "id, action, target_user, target_store, target_event, target_label, detail, created_at, admin:profiles!admin_actions_admin_id_fkey(display_name)";

/** Admin log entries, newest first (admin log page and a player's page). */
export function AdminLogList({ rows }: { rows: AdminLogRow[] }) {
  if (rows.length === 0) return <p className="card text-muted">No admin actions yet.</p>;
  return (
    <ul className="card divide-y divide-border !py-0">
      {rows.map((r) => {
        // Deleted stores have nothing left to link to.
        const href = r.target_user
          ? `/admin/players/${r.target_user}`
          : r.target_store && r.action !== "delete_store"
            ? `/admin/stores/${r.target_store}`
            : null;
        return (
          <li key={r.id} className="space-y-0.5 py-2">
            <p className="flex items-baseline justify-between gap-3">
              <span className="font-medium">
                {ADMIN_ACTION_LABELS[r.action] ?? r.action}:{" "}
                {href ? (
                  <Link href={href} className="text-accent-text">
                    {r.target_label ?? "unknown"}
                  </Link>
                ) : (
                  (r.target_label ?? "unknown")
                )}
              </span>
              <time dateTime={r.created_at} className="shrink-0 text-xs text-muted">
                {formatRelative(r.created_at)}
              </time>
            </p>
            <p className="text-sm text-muted">
              by {r.admin?.display_name ?? "a former admin"}
              {r.target_event && (
                <>
                  {" "}
                  ·{" "}
                  <Link href={`/events/${r.target_event}`} className="text-accent-text">
                    event
                  </Link>
                </>
              )}
            </p>
            {r.detail && <p className="text-sm">“{r.detail}”</p>}
          </li>
        );
      })}
    </ul>
  );
}
