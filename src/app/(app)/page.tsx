import Link from "next/link";
import { EventCard } from "@/components/event-card";
import { FirstRunGuide } from "@/components/first-run-guide";
import { InstallHint } from "@/components/install-hint";
import { NextArmoryCard } from "@/components/next-armory-card";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { StoreLink } from "@/components/store-link";
import { formatLocation } from "@/lib/stores";
import { STORE_SELECT, type StoreWithSchedules } from "@/components/store-card";
import { requireProfile } from "@/lib/auth";
import { getCurrentEvents, getNextAttendingEvent } from "@/lib/event-data";

export default async function HomePage() {
  const { supabase, user, profile } = await requireProfile();

  const [{ data }, next] = await Promise.all([
    supabase
      .from("user_stores")
      .select(`created_at, store:stores(${STORE_SELECT})`)
      .eq("user_id", user.id)
      .order("created_at"),
    getNextAttendingEvent(supabase, user.id),
  ]);
  // Archived stores no longer run events, so they drop off Home.
  const stores = (data ?? [])
    .map((row) => row.store as unknown as StoreWithSchedules)
    .filter((s) => s && !s.archived_at);
  const events = await getCurrentEvents(
    supabase,
    stores.map((s) => s.id),
    user.id,
  );

  return (
    <main className="space-y-6">
      {/* The app bar carries the wordmark; this keeps a page heading for screen readers. */}
      <h1 className="sr-only">ArmoryPal</h1>
      {/* New accounts get the getting-started guide once (also in the menu at /guide). */}
      {!profile.guide_seen_at && <FirstRunGuide />}

      {next ? (
        <>
          {/* Live going count and pledges, like the event page. */}
          <RealtimeRefresh topic={`event:${next.event.id}`} event="change" />
          <NextArmoryCard next={next} />
        </>
      ) : (
        stores.length > 0 && (
          <p className="card text-center text-muted">
            You&apos;re not signed up for an Armory yet. Pick an event below to go.
          </p>
        )
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">My stores</h2>
          {stores.length > 0 && (
            <Link href="/stores" className="text-sm font-medium text-accent-text">
              Find stores
            </Link>
          )}
        </div>
        {stores.length ? (
          <ul className="space-y-4">
            {stores.map((s) => (
              <li key={s.id}>
                {/* The store's events render inside its tile, so they read as part of the store. */}
                <StoreLink store={s} subtitle={formatLocation(s)}>
                  {(events.get(s.id) ?? []).length ? (
                    <ul className="space-y-2" aria-label={`This week at ${s.name}`}>
                      {events.get(s.id)!.map((e) => (
                        <li key={e.id}>
                          <EventCard event={e} timezone={s.timezone} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-xl bg-surface p-3 text-sm text-muted">No Armory scheduled.</p>
                  )}
                </StoreLink>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card space-y-3 text-center">
            <p className="text-muted">Add the store where you play Armory to see its weekly events.</p>
            <Link href="/stores" className="btn btn-primary">
              Find your store
            </Link>
          </div>
        )}
      </section>

      <InstallHint />
    </main>
  );
}
