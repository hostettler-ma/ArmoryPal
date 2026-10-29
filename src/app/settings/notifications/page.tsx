import { NotificationToggle } from "@/components/notification-toggle";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { NOTIFICATION_KINDS } from "@/lib/notifications";

export default async function NotificationSettingsPage() {
  const { supabase, user } = await requireProfile();
  const { data: prefs } = await supabase.from("notification_preferences").select("kind, enabled").eq("user_id", user.id);
  // No row means the kind is on (the default).
  const disabled = new Set((prefs ?? []).filter((p) => !p.enabled).map((p) => p.kind));

  return (
    <main className="space-y-5">
      <PageHeader title="Notification settings" back="/notifications" />
      <p className="text-sm text-muted">Choose what shows up in your notifications. Everything is on by default.</p>
      <ul className="card divide-y divide-border !py-0">
        {NOTIFICATION_KINDS.map((k) => (
          <NotificationToggle
            key={k.kind}
            kind={k.kind}
            label={k.label}
            description={k.description}
            enabled={!disabled.has(k.kind)}
          />
        ))}
      </ul>
    </main>
  );
}
