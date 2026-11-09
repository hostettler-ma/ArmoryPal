import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyGemIdButton, EventLinksForm, MoveEventButton, RenameEventButton } from "@/components/manage/manage-forms";
import { OwnerPollControls } from "@/components/manage/poll-controls";
import { PageHeader } from "@/components/page-header";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { isUuid, requireProfile, requireStoreManager } from "@/lib/auth";
import { gemFieldValue, toLocalInputs } from "@/lib/event-manage";
import { getEventPoll } from "@/lib/event-data";
import { eventPhase, formatEventWhen } from "@/lib/events";

/** Owner control page for one event: links, moving it, and who's going. */
export default async function ManageEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  // Look the event up first to know its store, then check the viewer manages it.
  const { supabase: lookup } = await requireProfile();
  const { data: ref } = await lookup.from("events").select("store_id").eq("id", id).maybeSingle();
  if (!ref) notFound();
  const { supabase, user } = await requireStoreManager(ref.store_id);

  const [{ data: event }, { data: requests }] = await Promise.all([
    supabase
      .from("events")
      .select(
        "*, store:stores(id, name, timezone, ticket_url), attendances(user_id, created_at, profile:profiles(display_name, gem_id))",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("requests").select("requester_id").eq("event_id", id).eq("status", "active"),
  ]);
  if (!event?.store) notFound();

  const ended = eventPhase(event) === "ended";
  const tz = event.store.timezone;
  const attendees = [...event.attendances].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const requestCount = new Map<string, number>();
  for (const r of requests ?? []) requestCount.set(r.requester_id, (requestCount.get(r.requester_id) ?? 0) + 1);
  const current = toLocalInputs(event.starts_at, tz);
  const poll = await getEventPoll(supabase, event, user.id);

  return (
    <main className="space-y-6">
      <PageHeader
        title={event.label}
        trail={[
          { label: "Manage", href: "/manage" },
          { label: event.store.name, href: `/manage/stores/${event.store.id}` },
        ]}
        action={
          <Link href={`/events/${event.id}`} className="text-sm font-medium text-accent-text">
            Player view
          </Link>
        }
      />
      {!ended && <RealtimeRefresh topic={`event:${event.id}`} event="change" />}

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold">{formatEventWhen(event.starts_at, tz)}</p>
          {event.moved_from && <p className="text-sm text-muted">Moved from {formatEventWhen(event.moved_from, tz)}</p>}
          {!event.schedule_id && <p className="text-sm text-muted">One-off event</p>}
        </div>
        {!ended && (
          <RenameEventButton eventId={event.id} storeId={event.store.id} label={event.label} weekly={!!event.schedule_id} />
        )}
      </div>

      {ended ? (
        <p className="card text-center text-muted">This event has ended.</p>
      ) : (
        <>
          <MoveEventButton
            eventId={event.id}
            storeId={event.store.id}
            date={current.date}
            time={current.time}
            weekly={!!event.schedule_id}
          />

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Format</h2>
            <OwnerPollControls
              eventId={event.id}
              results={poll?.results ?? null}
              hasPoll={!!poll}
              pollOpen={poll?.open ?? false}
              format={event.format}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Links</h2>
            <EventLinksForm
              eventId={event.id}
              storeId={event.store.id}
              gem={gemFieldValue(event)}
              ticket={event.ticket_url ?? ""}
              storeTicket={event.store.ticket_url}
            />
          </section>
        </>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Players going ({attendees.length})</h2>
        {attendees.length === 0 ? (
          <p className="card text-muted">Nobody has said they&apos;re going yet.</p>
        ) : (
          <ol className="card divide-y divide-border !py-0">
            {attendees.map((a, i) => {
              const n = requestCount.get(a.user_id) ?? 0;
              const name = a.profile?.display_name ?? "Unknown player";
              return (
                <li key={a.user_id} className="flex min-h-12 items-center gap-3 py-2">
                  <span className="w-6 shrink-0 text-right text-sm text-muted">{i + 1}.</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{name}</span>
                    <span className="block text-xs text-muted">
                      {a.profile?.gem_id ? (
                        <>
                          GEM ID <span className="font-mono select-all">{a.profile.gem_id}</span>
                        </>
                      ) : (
                        "No GEM ID"
                      )}
                    </span>
                  </span>
                  {n > 0 && (
                    <span className="shrink-0 text-sm text-muted">
                      {n} {n === 1 ? "request" : "requests"}
                    </span>
                  )}
                  {a.profile?.gem_id && <CopyGemIdButton gemId={a.profile.gem_id} name={name} />}
                </li>
              );
            })}
          </ol>
        )}
        <p className="text-xs text-muted">You get a notification when someone who was going leaves.</p>
      </section>
    </main>
  );
}
