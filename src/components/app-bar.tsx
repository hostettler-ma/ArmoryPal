import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { NavMenu } from "./nav-menu";
import { NotificationBell } from "./notification-bell";

/** Sticky top bar on every signed-in page (and the public pages when signed in): menu, wordmark, bell, profile. */
export function AppBar({
  supabase,
  userId,
  displayName,
  isAdmin,
  managesStores,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  displayName: string;
  isAdmin: boolean;
  managesStores: boolean;
}) {
  return (
    <BarShell menu={<NavMenu isAdmin={isAdmin} managesStores={managesStores} />}>
      <NotificationBell supabase={supabase} userId={userId} />
      <Link href="/me" className={CHIP}>
        <span className="truncate">{displayName}</span>
      </Link>
    </BarShell>
  );
}

/** The same bar for signed-out visitors on the public pages: a smaller menu and Sign in. */
export function PublicAppBar() {
  return (
    <BarShell menu={<NavMenu signedOut />}>
      <Link href="/login" className={CHIP}>
        Sign in
      </Link>
    </BarShell>
  );
}

const CHIP =
  "interactive flex h-control-md max-w-32 min-w-control-md items-center justify-center rounded-full border border-border bg-surface px-3 text-heading-01";

/** Menu, the ArmoryPal wordmark (→ Home), then the right-hand items. */
function BarShell({ menu, children }: { menu: React.ReactNode; children: React.ReactNode }) {
  return (
    // Cancels the root layout's top/side padding so the bar sits flush, then pads for the notch itself.
    <div className="sticky top-0 z-20 -mx-4 -mt-[max(1rem,env(safe-area-inset-top))] mb-4 flex items-center gap-1 border-b border-border bg-background/90 px-2 pt-[calc(0.25rem+env(safe-area-inset-top))] pb-1 backdrop-blur">
      {menu}
      <Link href="/" className="wordmark min-w-0 flex-1 truncate px-1">
        ArmoryPal
      </Link>
      {children}
    </div>
  );
}
