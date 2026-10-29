import Link from "next/link";
import type { EventSummary } from "@/lib/event-data";
import { formatEventWhen } from "@/lib/events";

/**
 * One weekly event as an inset row. Designed to sit inside a StoreLink frame
 * (Home) so it reads as part of the store, but works on its own too.
 */
export function EventCard({ event, timezone }: { event: EventSummary; timezone: string }) {
  return (
    <Link
      href={`/events/${event.id}`}
      className="flex min-h-14 items-center gap-3 rounded-xl border border-store/30 bg-surface p-3 text-foreground transition active:scale-[0.99] active:opacity-80"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{event.label}</p>
        <p className="text-sm text-muted">{formatEventWhen(event.starts_at, timezone)}</p>
      </div>
      <div className="shrink-0 text-right text-sm">
        {event.attending && (
          <span className="mb-1 block rounded-full bg-highlight px-2 py-0.5 text-xs font-semibold text-highlight-foreground">
            You&apos;re going
          </span>
        )}
        <span className="text-muted">{event.attendeeCount} going</span>
      </div>
      <span aria-hidden className="shrink-0 text-2xl leading-none text-muted">
        ›
      </span>
    </Link>
  );
}
