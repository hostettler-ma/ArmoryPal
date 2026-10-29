import { TZDate } from "@date-fns/tz";

export type Occurrence = {
  /** Store-local calendar date, "YYYY-MM-DD". */
  eventDate: string;
  startsAt: Date;
  /** End of the store-local event day; the event is read-only from then on. */
  endsAt: Date;
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The current occurrence of a weekly slot: the next `weekday` in the store's
 * time zone, counting today until the local day ends.
 * Mirrors SQL `public.event_occurrence` — keep them in sync (tests/db/events.test.ts).
 */
export function currentEventFor(
  schedule: { weekday: number; start_time: string },
  timezone: string,
  now: Date = new Date(),
): Occurrence {
  const local = new TZDate(now.getTime(), timezone);
  const daysAhead = (schedule.weekday - local.getDay() + 7) % 7;
  const [h, m] = schedule.start_time.split(":").map(Number);

  // TZDate normalizes day overflow (e.g. Oct 34 → Nov 3) and resolves the
  // wall-clock time in the zone, so DST offsets come out right.
  const startsAt = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + daysAhead, h, m, timezone);
  const endsAt = new TZDate(local.getFullYear(), local.getMonth(), local.getDate() + daysAhead + 1, 0, 0, timezone);
  const eventDate = `${startsAt.getFullYear()}-${pad(startsAt.getMonth() + 1)}-${pad(startsAt.getDate())}`;

  return { eventDate, startsAt: new Date(startsAt.getTime()), endsAt: new Date(endsAt.getTime()) };
}

export type EventPhase = "upcoming" | "live" | "ended";

export function eventPhase(event: { starts_at: string; ends_at: string }, now: Date = new Date()): EventPhase {
  if (now.getTime() >= new Date(event.ends_at).getTime()) return "ended";
  if (now.getTime() >= new Date(event.starts_at).getTime()) return "live";
  return "upcoming";
}

/**
 * Human label for when an event starts, in the store's time zone:
 * "Today · 6:30 PM", "Tomorrow · 6:30 PM", or "Tue, Nov 3 · 6:30 PM".
 */
export function formatEventWhen(startsAtIso: string, timezone: string, now: Date = new Date()): string {
  const start = new Date(startsAtIso);
  const time = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone });

  const localDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: timezone }); // YYYY-MM-DD
  const localNow = new TZDate(now.getTime(), timezone);
  const today = localDay(now);
  // Noon avoids DST-transition edge cases when stepping a day forward.
  const tomorrow = localDay(new TZDate(localNow.getFullYear(), localNow.getMonth(), localNow.getDate() + 1, 12, 0, timezone));
  const day = localDay(start);

  const dayLabel =
    day === today
      ? "Today"
      : day === tomorrow
        ? "Tomorrow"
        : start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: timezone });
  return `${dayLabel} · ${time}`;
}
