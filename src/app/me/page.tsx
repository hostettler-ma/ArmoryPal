import Link from "next/link";
import { signOut } from "@/app/actions/profile";
import { ProfileForm } from "@/components/profile-form";
import { requireProfile } from "@/lib/auth";

export default async function MePage() {
  const { user, profile } = await requireProfile();

  return (
    <main className="space-y-6">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-muted" aria-label="Back">
          ←
        </Link>
        <h1 className="text-2xl font-bold">Profile</h1>
      </header>
      <p className="text-sm text-muted">Signed in as {user.email ?? "Discord user"}</p>
      <ProfileForm displayName={profile.display_name} gemId={profile.gem_id ?? ""} submitLabel="Save" />
      <Link href="/settings/notifications" className="btn btn-secondary">
        Notification settings
      </Link>
      <form action={signOut}>
        <button className="btn btn-secondary">Sign out</button>
      </form>
    </main>
  );
}
