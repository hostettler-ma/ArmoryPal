import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CancelEventButton,
  CopyGemIdButton,
  DeleteEventButton,
  EventLinksForm,
  MoveEventButton,
  RenameEventButton,
} from "@/components/manage/manage-forms";
import { CancelledNotice } from "@/components/event/cancelled-notice";
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
        "*, store:stores(id, name, timezone, ticket_url), attendances(user_id, created_at, profile:profiles(display_name, gem_id)), discord_attendees(id, display_name, created_at)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("requests").select("requester_id").eq("event_id", id).eq("status", "active"),
  ]);
  if (!event?.store) notFound();

  const ended = eventPhase(event) === "ended";
  const cancelled = !!event.cancelled_at;
  const tz = event.store.timezone;
  // Players and Discord guests (ArmoryBot's Going without an account), in join order.
  const attendees = [
    ...event.attendances.map((a) => ({
      key: a.user_id,
      userId: a.user_id as string | null,
      name: a.profile?.display_name ?? "Unknown player",
      gemId: a.profile?.gem_id ?? null,
      created_at: a.created_at,
    })),
    ...event.discord_attendees.map((g) => ({
      key: g.id,
      userId: null,
      name: g.display_name,
      gemId: null,
      created_at: g.created_at,
    })),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));
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
          <Link href={`/events/${event.id}`} className="text-label link">
            Player view
          </Link>
        }
      />
      {!ended && <RealtimeRefresh topic={`event:${event.id}`} event="change" />}

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-heading-02">{formatEventWhen(event.starts_at, tz)}</p>
          {event.moved_from && <p className="text-body-compact text-muted">Moved from {formatEventWhen(event.moved_from, tz)}</p>}
          {!event.schedule_id && <p className="text-body-compact text-muted">One-off event</p>}
        </div>
        {!ended && !cancelled && (
          <RenameEventButton eventId={event.id} storeId={event.store.id} label={event.label} weekly={!!event.schedule_id} />
        )}
      </div>

      {ended ? (
        <p className="card text-center text-muted">This event has ended.</p>
      ) : cancelled ? (
        <CancelledNotice note={event.cancel_note} />
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
            <h2 className="text-heading-03">Format</h2>
            <OwnerPollControls
              eventId={event.id}
              results={poll?.results ?? null}
              hasPoll={!!poll}
              pollOpen={poll?.open ?? false}
              format={event.format}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-heading-03">Links</h2>
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
        <h2 className="text-heading-03">Players going ({attendees.length})</h2>
        {attendees.length === 0 ? (
          <p className="card text-muted">Nobody has said they&apos;re going yet.</p>
        ) : (
          <ol className="card-list">
            {attendees.map((a, i) => {
              const n = a.userId ? (requestCount.get(a.userId) ?? 0) : 0;
              const name = a.name;
              return (
                <li key={a.key} className="flex min-h-control-lg items-center gap-3 py-2">
                  <span className="w-6 shrink-0 text-right text-body-compact text-muted">{i + 1}.</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{name}</span>
                    <span className="block text-helper text-muted">
                      {!a.userId ? (
                        "Via Discord, no ArmoryPal account"
                      ) : a.gemId ? (
                        <>
                          GEM ID <span className="font-mono select-all">{a.gemId}</span>
                        </>
                      ) : (
                        "No GEM ID"
                      )}
                    </span>
                  </span>
                  {n > 0 && (
                    <span className="shrink-0 text-body-compact text-muted">
                      {n} {n === 1 ? "request" : "requests"}
                    </span>
                  )}
                  {a.gemId && <CopyGemIdButton gemId={a.gemId} name={name} />}
                </li>
              );
            })}
          </ol>
        )}
        <p className="text-helper text-muted">You get a notification when someone who was going leaves.</p>
      </section>

      {!ended && (
        <section className="space-y-3">
          <h2 className="text-heading-03">{cancelled ? "Delete" : "Cancel or delete"}</h2>
          <div className="flex flex-col gap-3">
            {!cancelled && <CancelEventButton eventId={event.id} storeId={event.store.id} />}
            <DeleteEventButton eventId={event.id} storeId={event.store.id} weekly={!!event.schedule_id} />
          </div>
          <p className="text-helper text-muted">
            {cancelled
              ? "Deleting removes the event for everyone, without a notification."
              : "Cancelling keeps the event visible, marked cancelled, and notifies players. Deleting removes it without a notification."}
          </p>
        </section>
      )}
    </main>
  );
}
