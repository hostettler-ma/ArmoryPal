import { AppBar, PublicAppBar } from "@/components/app-bar";
import { getOptionalProfile } from "@/lib/auth";

/**
 * Public pages (/about, /discord-bot) that newcomers read signed out: the app bar is always
 * there, the full one when signed in, otherwise one with the public menu and Sign in.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getOptionalProfile();
  return (
    <>
      {ctx ? (
        <AppBar
          supabase={ctx.supabase}
          userId={ctx.user.id}
          displayName={ctx.profile.display_name}
          isAdmin={ctx.profile.is_admin}
          managesStores={ctx.managesStores}
        />
      ) : (
        <PublicAppBar />
      )}
      {children}
    </>
  );
}
