import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { formatEventWhen } from "@/lib/events";
import { formatNotification, formatRelative, notificationHref, type NotificationPayload } from "@/lib/notifications";

export default async function NotificationsPage() {
  const { supabase, user } = await requireProfile();

  const { data: notifications } = await supabase
    .from("notifications")
    .select("id, kind, payload, read_at, created_at, event:events(id, starts_at, label, store:stores(name, timezone))")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  // Opening the inbox marks everything read; this render still shows what was new.
  if (notifications?.some((n) => !n.read_at)) await supabase.rpc("mark_notifications_read");

  return (
    <main className="space-y-5">
      <PageHeader
        title="Notifications"
        action={
          <Link href="/settings/notifications" className="text-sm font-medium text-accent-text">
            Settings
          </Link>
        }
      />
      {!notifications?.length ? (
        <p className="card text-muted">Nothing yet. You&apos;ll hear here when plans change for cards you asked for or promised to bring.</p>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li key={n.id}>
              <Link
                href={notificationHref(n.kind, n.event?.id, n.payload as NotificationPayload)}
                className={`card block space-y-1 ${n.read_at ? "" : "border-accent"}`}
              >
                <p className={n.read_at ? "" : "font-semibold"}>
                  {!n.read_at && <span className="mr-1 text-accent-text" aria-label="New">●</span>}
                  {formatNotification(n.kind, n.payload as NotificationPayload)}
                </p>
                <p className="text-sm text-muted">
                  {n.event?.store
                    ? `${n.event.label} at ${n.event.store.name} · ${formatEventWhen(n.event.starts_at, n.event.store.timezone)} · `
                    : ""}
                  {formatRelative(n.created_at)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
