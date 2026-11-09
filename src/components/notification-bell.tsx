import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { RealtimeRefresh } from "./realtime-refresh";

/** Bell with unread count; updates live via the user's private Realtime topic. */
export async function NotificationBell({ supabase, userId }: { supabase: SupabaseClient<Database>; userId: string }) {
  const { count } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  const unread = count ?? 0;

  return (
    <>
      <Link
        href="/notifications"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="interactive relative flex size-control-lg items-center justify-center rounded-full text-muted"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-icon-lg fill-none stroke-current" strokeWidth={2}>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-2 right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-tag text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Link>
      <RealtimeRefresh topic={`user:${userId}`} event="notification" />
    </>
  );
}
