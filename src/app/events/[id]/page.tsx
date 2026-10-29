import { notFound } from "next/navigation";
import { AttendanceButton } from "@/components/attendance-button";
import { PageHeader } from "@/components/page-header";
import { isUuid, requireProfile } from "@/lib/auth";
import { eventPhase, formatEventWhen } from "@/lib/events";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase, user } = await requireProfile();

  const { data: event } = await supabase
    .from("events")
    .select(
      "*, store:stores(id, name, timezone), schedule:store_schedules(label), attendances(user_id, created_at, profile:profiles(display_name))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!event?.store || !event.schedule) notFound();

  const phase = eventPhase(event);
  const attendees = [...event.attendances].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const attending = attendees.some((a) => a.user_id === user.id);

  return (
    <main className="space-y-5">
      <PageHeader title={event.schedule.label} back={`/stores/${event.store.id}`} />

      <div className="space-y-1">
        <p className="font-semibold">{event.store.name}</p>
        <p className="text-muted">
          {formatEventWhen(event.starts_at, event.store.timezone)}
          {phase === "live" && <span className="ml-2 font-semibold text-accent">● Happening now</span>}
        </p>
      </div>

      {phase === "ended" ? (
        <p className="card text-center text-muted">This event has ended.</p>
      ) : (
        <AttendanceButton eventId={event.id} attending={attending} />
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Going <span className="font-normal text-muted">({attendees.length})</span>
        </h2>
        {attendees.length === 0 ? (
          <p className="card text-muted">Nobody has said they&apos;re going yet.</p>
        ) : (
          <ul className="card divide-y divide-border !py-0">
            {attendees.map((a) => (
              <li key={a.user_id} className="flex min-h-12 items-center justify-between py-2">
                <span>{a.profile?.display_name ?? "Unknown player"}</span>
                {a.user_id === user.id && <span className="text-sm text-muted">You</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted">Card requests and the bring list arrive in Phase 4.</p>
    </main>
  );
}
