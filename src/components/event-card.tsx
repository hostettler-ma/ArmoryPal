import Link from "next/link";
import type { EventSummary } from "@/lib/event-data";
import { formatEventWhen } from "@/lib/events";
import { formatLabel } from "@/lib/formats";

/**
 * One weekly event as an inset row. Designed to sit inside a StoreLink frame
 * (Home) so it reads as part of the store, but works on its own too.
 */
export function EventCard({
  event,
  timezone,
  href = `/events/${event.id}`,
}: {
  event: EventSummary;
  timezone: string;
  /** Defaults to the event page; owner screens link to /manage/events/[id]. */
  href?: string;
}) {
  return (
    <Link
      href={href}
      className="interactive flex min-h-control-lg items-center gap-3 rounded-control border border-store/30 bg-surface p-3 text-foreground"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-heading-02">{event.label}</p>
        <p className="text-body-compact text-muted">
          {formatEventWhen(event.starts_at, timezone)}
          {event.moved_from && (
            <span className="ml-2 rounded-full border border-border px-2 text-helper">Moved</span>
          )}
        </p>
        {event.format ? (
          <p className="text-body-compact">{formatLabel(event.format)}</p>
        ) : (
          event.pollWaiting && <p className="text-label text-accent-text">Vote on the format</p>
        )}
      </div>
      <div className="shrink-0 text-right text-body-compact">
        {event.attending && (
          <span className="mb-1 block rounded-full bg-highlight px-2 py-0.5 text-tag text-highlight-foreground">
            You&apos;re going
          </span>
        )}
        <span className="text-muted">{event.attendeeCount} going</span>
      </div>
      <span aria-hidden className="shrink-0 text-glyph text-muted">
        ›
      </span>
    </Link>
  );
}
