import { AppBar } from "@/components/app-bar";
import { getOwnedStoreIds, requireProfile } from "@/lib/auth";

/** Signed-in pages: the app bar (menu, logo, bell, profile) above every page. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user, profile } = await requireProfile();
  const owned = await getOwnedStoreIds();
  return (
    <>
      <AppBar
        supabase={supabase}
        userId={user.id}
        displayName={profile.display_name}
        isAdmin={profile.is_admin}
        managesStores={owned.length > 0}
      />
      {children}
    </>
  );
}
