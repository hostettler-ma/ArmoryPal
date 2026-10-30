import Link from "next/link";
import { PitchDot } from "@/components/pitch-dot";
import { StoreLink } from "@/components/store-link";
import { cardLabel } from "@/lib/cards";
import type { NextArmory } from "@/lib/event-data";
import { eventPhase, formatEventWhen } from "@/lib/events";
import { summarizeBringing } from "@/lib/request-view";

/**
 * Home's at-a-glance card: the next Armory I'm going to, how many are going,
 * and what I promised to bring.
 */
export function NextArmoryCard({ next }: { next: NextArmory }) {
  const { event, attendeeCount, bringing } = next;
  const live = eventPhase(event) === "live";
  const { cards, players } = summarizeBringing(bringing);
  const eventHref = `/events/${event.id}`;

  return (
    <section className="card space-y-4" aria-label="Your next Armory">
      <Link href={eventHref} className="flex items-start gap-3 transition active:opacity-80">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-muted">Your next Armory</p>
          <p className="truncate text-xl font-bold">{event.label}</p>
          <p className="text-sm font-semibold">
            {formatEventWhen(event.starts_at, event.store.timezone)}
            {live && <span className="ml-2 text-live">● Happening now</span>}
          </p>
        </div>
        <div className="shrink-0 rounded-xl bg-highlight px-3 py-2 text-center text-highlight-foreground">
          <p className="text-2xl leading-none font-bold">{attendeeCount}</p>
          <p className="text-xs font-semibold">going</p>
        </div>
      </Link>

      <StoreLink store={event.store} />

      <div className="space-y-2">
        {bringing.length === 0 ? (
          <p className="text-sm text-muted">
            You&apos;re not bringing any cards yet.{" "}
            <Link href={`${eventHref}?tab=requests`} className="font-medium text-accent-text">
              Browse requests
            </Link>
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-semibold">
                Bringing {cards} {cards === 1 ? "card" : "cards"} for {players} {players === 1 ? "player" : "players"}
              </h2>
              <Link href={`${eventHref}?tab=checklist`} className="shrink-0 text-sm font-medium text-accent-text">
                Checklist
              </Link>
            </div>
            <ul className="divide-y divide-border">
              {bringing.map((b) => (
                <li key={b.requestId} className="flex min-h-10 items-center gap-3 py-1.5">
                  <PitchDot color={b.card.color} />
                  <span className="min-w-0 flex-1 truncate">
                    {b.quantity}× {cardLabel(b.card)}
                  </span>
                  <span className="shrink-0 text-sm text-muted">for {b.requesterName}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
