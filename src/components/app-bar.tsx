import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { NavMenu } from "./nav-menu";
import { NotificationBell } from "./notification-bell";

/** Sticky top bar on every signed-in page: menu, ArmoryPal wordmark (→ Home), bell, profile. */
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
    // Cancels the root layout's top/side padding so the bar sits flush, then pads for the notch itself.
    <div className="sticky top-0 z-20 -mx-4 -mt-[max(1rem,env(safe-area-inset-top))] mb-4 flex items-center gap-1 border-b border-border bg-background/90 px-2 pt-[calc(0.25rem+env(safe-area-inset-top))] pb-1 backdrop-blur">
      <NavMenu isAdmin={isAdmin} managesStores={managesStores} />
      <Link href="/" className="wordmark min-w-0 flex-1 truncate px-1">
        ArmoryPal
      </Link>
      <NotificationBell supabase={supabase} userId={userId} />
      <Link
        href="/me"
        className="interactive flex h-control-md max-w-32 min-w-control-md items-center justify-center rounded-full border border-border bg-surface px-3 text-heading-01"
      >
        <span className="truncate">{displayName}</span>
      </Link>
    </div>
  );
}
