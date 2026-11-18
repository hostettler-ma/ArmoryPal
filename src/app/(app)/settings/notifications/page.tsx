import Link from "next/link";
import { NotificationToggle } from "@/components/notification-toggle";
import { PageHeader } from "@/components/page-header";
import { getOwnedStoreIds, requireProfile } from "@/lib/auth";
import { hasDiscord } from "@/lib/connected-accounts";
import { DISCORD_DM_KINDS, isNotificationEnabled, NOTIFICATION_KINDS } from "@/lib/notifications";

/** Why ArmoryBot's last DM didn't arrive (Discord error codes stored by the worker). */
const DM_PROBLEMS: Record<number, string> = {
  50007: "Discord didn't let ArmoryBot DM you. Allow direct messages from server members in Discord's privacy settings.",
  50278: "ArmoryBot can only DM you while you're in a Discord server it's in. Join your store's server.",
};

export default async function NotificationSettingsPage() {
  const { supabase, user } = await requireProfile();
  const [{ data: prefs }, { data: dmStatus }, ownedStores] = await Promise.all([
    supabase.from("notification_preferences").select("kind, channel, enabled").eq("user_id", user.id),
    supabase.from("discord_dm_status").select("error_code").eq("user_id", user.id).maybeSingle(),
    getOwnedStoreIds(),
  ]);
  const rows = prefs ?? [];
  const isOwner = ownedStores.length > 0;
  const discordLinked = hasDiscord(user.identities);
  const dmKinds = NOTIFICATION_KINDS.filter((k) => DISCORD_DM_KINDS.includes(k.kind));

  return (
    <main className="space-y-6">
      <PageHeader title="Notification settings" trail={[{ label: "Notifications", href: "/notifications" }]} />
      <p className="text-body-compact text-muted">Choose what shows up in your notifications. Everything is on by default.</p>
      <ul className="card-list">
        {NOTIFICATION_KINDS.filter((k) => isOwner || !k.ownersOnly).map((k) => (
          <NotificationToggle
            key={k.kind}
            kind={k.kind}
            label={k.label}
            description={k.description}
            enabled={isNotificationEnabled(k.kind, "app", rows)}
          />
        ))}
      </ul>

      <section aria-labelledby="discord-dms-title" className="space-y-3">
        <h2 id="discord-dms-title" className="text-heading-03">
          Discord DMs
        </h2>
        {discordLinked ? (
          <>
            <p className="text-body-compact text-muted">
              ArmoryBot can also DM you on Discord, batched every couple of minutes. These are off until you turn them on.
            </p>
            {dmStatus && DM_PROBLEMS[dmStatus.error_code] && (
              <p role="status" className="card text-body-compact">
                {DM_PROBLEMS[dmStatus.error_code]}
              </p>
            )}
            <ul className="card-list">
              {dmKinds.map((k) => (
                <NotificationToggle
                  key={k.kind}
                  kind={k.kind}
                  channel="discord"
                  label={k.label}
                  description={k.description}
                  enabled={isNotificationEnabled(k.kind, "discord", rows)}
                />
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="text-body-compact text-muted">ArmoryBot can DM you on Discord about new requests and cards needed again.</p>
            <Link href="/me#connected-accounts" className="btn btn-secondary">
              Connect Discord to get DMs
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
