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
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
  displayName: string;
  isAdmin: boolean;
}) {
  return (
    // Cancels the root layout's top/side padding so the bar sits flush, then pads for the notch itself.
    <div className="sticky top-0 z-20 -mx-4 -mt-[max(1rem,env(safe-area-inset-top))] mb-4 flex items-center gap-1 border-b border-border bg-background/90 px-2 pt-[calc(0.375rem+env(safe-area-inset-top))] pb-1.5 backdrop-blur">
      <NavMenu isAdmin={isAdmin} />
      <Link href="/" className="font-logo min-w-0 flex-1 truncate px-1 text-xl font-bold tracking-wide">
        ArmoryPal
      </Link>
      <NotificationBell supabase={supabase} userId={userId} />
      <Link
        href="/me"
        className="flex h-10 max-w-32 min-w-10 items-center justify-center rounded-full bg-surface px-3 text-sm font-semibold ring-1 ring-border"
      >
        <span className="truncate">{displayName}</span>
      </Link>
    </div>
  );
}
