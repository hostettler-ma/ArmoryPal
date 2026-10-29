import Link from "next/link";
import type { EventSummary } from "@/lib/event-data";
import { formatEventWhen } from "@/lib/events";

export function EventCard({ event, timezone }: { event: EventSummary; timezone: string }) {
  return (
    <Link href={`/events/${event.id}`} className="card flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{event.label}</p>
        <p className="text-sm text-muted">{formatEventWhen(event.starts_at, timezone)}</p>
      </div>
      <div className="shrink-0 text-right text-sm">
        {event.attending && (
          <span className="mb-1 block rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">
            You&apos;re going
          </span>
        )}
        <span className="text-muted">
          {event.attendeeCount} going
        </span>
      </div>
    </Link>
  );
}
