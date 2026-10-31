import Link from "next/link";
import { notFound } from "next/navigation";
import { AttendanceButton } from "@/components/attendance-button";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { RemoveAttendeeButton } from "@/components/admin/moderation-buttons";
import { AddRequestSheet } from "@/components/event/add-request-sheet";
import { CopyRequestsBanner } from "@/components/event/copy-requests-banner";
import { getCopyCandidate } from "@/lib/event-data";
import { RequestRow } from "@/components/event/request-row";
import { PageHeader } from "@/components/page-header";
import { StoreLink } from "@/components/store-link";
import { StoreNotes } from "@/components/store-notes";
import { formatLocation } from "@/lib/stores";
import { PitchDot } from "@/components/pitch-dot";
import { isUuid, requireProfile } from "@/lib/auth";
import { cardLabel, formatReleaseMonth } from "@/lib/cards";
import { eventPhase, formatEventWhen } from "@/lib/events";
import { buildPeopleList, buildRequestViews, type LoadedRequest } from "@/lib/request-view";

// Display order; the first tab is the default.
const TABS = ["going", "requests", "checklist"] as const;
type Tab = (typeof TABS)[number];

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const tabParam = (await searchParams).tab;
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : TABS[0];
  const { supabase, user, profile } = await requireProfile();

  const [{ data: event }, { data: requestRows }, { data: meta }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "*, store:stores(id, name, timezone, city, region, country, notes), schedule:store_schedules(label), attendances(user_id, created_at, profile:profiles(display_name))",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("requests")
      .select(
        "id, quantity, note, requester_id, created_at, card:cards(id, name, pitch, color, types, set_ids), requester:profiles(display_name), pledges(pledger_id, quantity, pledger:profiles(display_name))",
      )
      .eq("event_id", id)
      .eq("status", "active"),
    supabase.from("catalog_meta").select("latest_set_name, latest_set_released_on").maybeSingle(),
  ]);
  if (!event?.store || !event.schedule) notFound();

  const phase = eventPhase(event);
  const ended = phase === "ended";
  const attendees = [...event.attendances].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const attending = attendees.some((a) => a.user_id === user.id);
  // Only attendees of an open event can copy last week's unfilled requests in.
  const copyCandidate = !ended && attending ? await getCopyCandidate(supabase, event, user.id) : null;
  const requests = buildRequestViews(
    (requestRows ?? []) as LoadedRequest[],
    { id: user.id, attending, eventEnded: ended },
    new Set(attendees.map((a) => a.user_id)),
  );
  const mine = requests.filter((r) => r.isMine);
  const myPledges = requests.filter((r) => r.myPledge > 0);
  const stillNeeded = requests.filter((r) => r.coverage !== "covered").length;
  const people = buildPeopleList(
    attendees.map((a) => ({ user_id: a.user_id, name: a.profile?.display_name ?? "Unknown player" })),
    requests,
    user.id,
  );
  const catalogNote = meta
    ? `Cards up to ${meta.latest_set_name}${meta.latest_set_released_on ? ` (${formatReleaseMonth(meta.latest_set_released_on)})` : ""}. Card data: the-fab-cube/flesh-and-blood-cards.`
    : null;

  const tabLabel: Record<Tab, string> = {
    requests: `Requests (${stillNeeded})`,
    checklist: `My checklist (${mine.length + myPledges.length})`,
    going: `Going (${attendees.length})`,
  };

  return (
    <main className="space-y-5">
      <PageHeader
        title={event.schedule.label}
        trail={[
          { label: event.store.name, href: `/stores/${event.store.id}` },
          ...(ended ? [{ label: "Past events", href: `/stores/${event.store.id}/history` }] : []),
        ]}
      />
      {/* Live updates: re-render when anyone changes attendance, requests, or pledges. */}
      {!ended && <RealtimeRefresh topic={`event:${event.id}`} event="change" />}

      <div className="space-y-2">
        <p className="font-semibold">
          {formatEventWhen(event.starts_at, event.store.timezone)}
          {phase === "live" && <span className="ml-2 text-live">● Happening now</span>}
        </p>
        <StoreLink store={event.store} subtitle={formatLocation(event.store)} />
        {!ended && <StoreNotes notes={event.store.notes} />}
      </div>

      {ended ? (
        <p className="card text-center text-muted">
          This event has ended. Lists are read-only.{" "}
          <Link href={`/stores/${event.store.id}/history`} className="font-medium text-accent-text">
            Past events
          </Link>
        </p>
      ) : (
        <AttendanceButton
          key={String(attending)} // fresh state (no stale confirmation) after attending changes
          eventId={event.id}
          attending={attending}
          pledgedCards={myPledges.reduce((sum, r) => sum + r.myPledge, 0)}
          openRequests={mine.length}
        />
      )}

      {copyCandidate && (
        <CopyRequestsBanner eventId={event.id} fromEventId={copyCandidate.fromEventId} summary={copyCandidate.summary} />
      )}

      <nav className="flex gap-1 rounded-xl bg-surface p-1 ring-1 ring-border" aria-label="Event sections">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/events/${event.id}?tab=${t}`}
            replace
            scroll={false}
            aria-current={t === tab ? "page" : undefined}
            className={`flex-auto rounded-lg px-2 py-2 text-center text-sm font-medium whitespace-nowrap ${t === tab ? "bg-accent text-accent-foreground" : "text-muted"}`}
          >
            {tabLabel[t]}
          </Link>
        ))}
      </nav>

      {tab === "requests" && (
        <section className="space-y-3">
          {!ended && !attending && (
            <p className="card text-sm text-muted">Mark yourself as going to request cards or bring them for others.</p>
          )}
          {!ended && attending && <AddRequestSheet eventId={event.id} catalogNote={catalogNote} />}
          {requests.length === 0 ? (
            <p className="card text-muted">No card requests yet.</p>
          ) : (
            <ul className="space-y-2">
              {requests.map((r) => (
                <RequestRow key={r.id} eventId={event.id} request={r} mode="bring" editable={!ended && attending} />
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "checklist" && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Cards I&apos;m bringing</h2>
            {myPledges.length === 0 ? (
              <p className="card text-muted">You haven&apos;t promised to bring anything.</p>
            ) : (
              <ul className="card divide-y divide-border !py-0">
                {myPledges.map((r) => (
                  <li key={r.id} className="flex min-h-12 items-center gap-3 py-2">
                    <PitchDot color={r.card.color} />
                    <span className="min-w-0 flex-1 truncate">
                      {r.myPledge}× {cardLabel(r.card)}
                    </span>
                    <span className="shrink-0 text-sm text-muted">for {r.requesterName}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Cards I need</h2>
            {!ended && attending && <AddRequestSheet eventId={event.id} catalogNote={catalogNote} />}
            {mine.length === 0 ? (
              <p className="card text-muted">You haven&apos;t requested any cards.</p>
            ) : (
              <ul className="space-y-2">
                {mine.map((r) => (
                  <RequestRow key={r.id} eventId={event.id} request={r} mode="mine" editable={!ended} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {tab === "going" && (
        <section className="space-y-3">
          {people.length === 0 ? (
            <p className="card text-muted">Nobody has said they&apos;re going yet.</p>
          ) : (
            <ul className="card divide-y divide-border !py-0">
              {people.map((p) => (
                <li key={p.id} className="flex min-h-12 items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate">
                    {p.name}
                    {p.isMe && <span className="ml-1 text-sm text-muted">(you)</span>}
                    {!p.attending && (
                      <span className="ml-2 rounded-full border border-border px-1.5 text-xs text-muted">Not going</span>
                    )}
                  </span>
                  {p.requests > 0 && (
                    <span className="shrink-0 text-right text-sm">
                      {p.requests} {p.requests === 1 ? "request" : "requests"}
                      <span className="block text-xs text-muted">
                        {p.stillNeeded === 0 ? "all covered" : `${p.stillNeeded} still needed`}
                      </span>
                    </span>
                  )}
                  {/* Admins can take others off an open event (admin_remove_attendee). */}
                  {profile.is_admin && !ended && p.attending && !p.isMe && (
                    <RemoveAttendeeButton eventId={event.id} userId={p.id} name={p.name} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
