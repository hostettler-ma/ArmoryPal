import Link from "next/link";
import { signOut } from "@/app/actions/profile";
import { ConnectedAccounts } from "@/components/connected-accounts";
import { FanNotice } from "@/components/fan-notice";
import { PageHeader } from "@/components/page-header";
import { ProfileForm } from "@/components/profile-form";
import { requireProfile } from "@/lib/auth";
import { connectedAccounts, linkErrorMessage } from "@/lib/connected-accounts";

export default async function MePage({ searchParams }: { searchParams: Promise<{ link_error?: string }> }) {
  const { user, profile } = await requireProfile();
  const { link_error } = await searchParams;

  return (
    <main className="space-y-6">
      <PageHeader title="Profile" />
      <p className="text-body-compact text-muted">Signed in as {user.email ?? "Discord user"}</p>
      <ProfileForm displayName={profile.display_name} gemId={profile.gem_id ?? ""} submitLabel="Save" />
      <ConnectedAccounts rows={connectedAccounts(user.identities ?? [])} initialError={linkErrorMessage(link_error)} />
      <Link href="/settings/notifications" className="btn btn-secondary">
        Notification settings
      </Link>
      <form action={signOut}>
        <button className="btn btn-secondary">Sign out</button>
      </form>

      <FanNotice />
    </main>
  );
}
