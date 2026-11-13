import { TZDate } from "@date-fns/tz";

// Owner tools for events. These mirror the checks in
// supabase/migrations/*_event_management.sql (the source of truth): change both together.

export const MAX_URL_LENGTH = 300;
export const MAX_EVENT_LABEL = 40;
/** Cancelling an event: the optional message for players ("Closed for Thanksgiving"). */
export const MAX_CANCEL_NOTE = 140;
/** One-off events (and moves of them) can be at most this many days ahead. */
export const MAX_DAYS_AHEAD = 90;

const HTTPS_URL = /^https:\/\/[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$/;
const GEM_HOST = /^https:\/\/([a-z0-9-]+\.)*fabtcg\.com([/?#]|$)/i;
const GEM_CODE = /^[A-Za-z0-9-]{1,32}$/;

export function isHttpsUrl(url: string): boolean {
  return url.length <= MAX_URL_LENGTH && HTTPS_URL.test(url);
}

export function isGemUrl(url: string): boolean {
  return isHttpsUrl(url) && GEM_HOST.test(url);
}

export type EventLinks = { gem_url: string | null; gem_code: string | null; ticket_url: string | null };
export type LinksResult = { ok: true; value: EventLinks } | { ok: false; errors: { gem?: string; ticket?: string } };

/**
 * The owner types one GEM field (a gem.fabtcg.com link or the event code) and
 * a ticket link. Blank means "no link".
 */
export function parseEventLinks(input: { gem?: unknown; ticket?: unknown }): LinksResult {
  const gem = typeof input.gem === "string" ? input.gem.trim() : "";
  const ticket = typeof input.ticket === "string" ? input.ticket.trim() : "";
  const errors: { gem?: string; ticket?: string } = {};
  const value: EventLinks = { gem_url: null, gem_code: null, ticket_url: null };

  if (/^https?:\/\//i.test(gem)) {
    if (isGemUrl(gem)) value.gem_url = gem;
    else errors.gem = "Use an https link on gem.fabtcg.com, or just the event code.";
  } else if (gem) {
    const code = gem.replace(/^#/, "");
    if (GEM_CODE.test(code)) value.gem_code = code;
    else errors.gem = "An event code has only letters, digits and dashes.";
  }

  if (ticket) {
    if (isHttpsUrl(ticket)) value.ticket_url = ticket;
    else errors.ticket = "Use a full https:// link to your ticket page.";
  }

  return errors.gem || errors.ticket ? { ok: false, errors } : { ok: true, value };
}

/** The optional cancel message: trimmed, blank means none. Mirrors owner_cancel_event(). */
export function parseCancelNote(input: unknown): { ok: true; value: string | null } | { ok: false } {
  const note = typeof input === "string" ? input.trim() : "";
  if (note.length > MAX_CANCEL_NOTE) return { ok: false };
  return { ok: true, value: note || null };
}

/** The GEM field's value for the form: the link if there is one, otherwise the code. */
export function gemFieldValue(event: { gem_url: string | null; gem_code: string | null }): string {
  return event.gem_url ?? event.gem_code ?? "";
}

/** The ticket link to show players: the event's own, else the store's default. */
export function ticketLink(event: { ticket_url: string | null }, store: { ticket_url: string | null }): string | null {
  return event.ticket_url ?? store.ticket_url ?? null;
}

export type ManageError = "move_in_past" | "move_too_far" | "date_in_past" | "too_far_ahead" | "invalid_label";
export type ManageCheck = { ok: true; startsAt: Date; endsAt: Date } | { ok: false; reason: ManageError };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:\d{2})?$/;

/** Start and end (end of the local day) of an event on a store-local date. Mirrors SQL event_times(). */
export function eventTimes(date: string, time: string, timezone: string): { startsAt: Date; endsAt: Date } | null {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) return null;
  const [y, m, day] = [Number(d[1]), Number(d[2]) - 1, Number(d[3])];
  const startsAt = new TZDate(y, m, day, Number(t[1]), Number(t[2]), timezone);
  const endsAt = new TZDate(y, m, day + 1, 0, 0, timezone);
  return { startsAt: new Date(startsAt.getTime()), endsAt: new Date(endsAt.getTime()) };
}

/** Whole days from date a to date b ("YYYY-MM-DD"). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Today's date in the store's time zone, "YYYY-MM-DD". */
export function localToday(timezone: string, now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: timezone });
}

/** May an event be moved to `date` at `time`? Weekly events stay within a week of their slot. */
export function validateMove(
  event: { slotDate: string | null },
  date: string,
  time: string,
  timezone: string,
  now: Date = new Date(),
): ManageCheck {
  const times = eventTimes(date, time, timezone);
  if (!times || times.startsAt.getTime() <= now.getTime()) return { ok: false, reason: "move_in_past" };
  if (event.slotDate) {
    if (Math.abs(daysBetween(event.slotDate, date)) >= 7) return { ok: false, reason: "move_too_far" };
  } else if (daysBetween(localToday(timezone, now), date) > MAX_DAYS_AHEAD) {
    return { ok: false, reason: "too_far_ahead" };
  }
  return { ok: true, ...times };
}

/** May a one-off event be created on `date` at `time`? Today is fine until the day ends. */
export function validateOneOff(label: string, date: string, time: string, timezone: string, now: Date = new Date()): ManageCheck {
  const trimmed = label.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_EVENT_LABEL) return { ok: false, reason: "invalid_label" };
  const times = eventTimes(date, time, timezone);
  if (!times || times.endsAt.getTime() <= now.getTime()) return { ok: false, reason: "date_in_past" };
  if (daysBetween(localToday(timezone, now), date) > MAX_DAYS_AHEAD) return { ok: false, reason: "too_far_ahead" };
  return { ok: true, ...times };
}

/** "YYYY-MM-DD" and "HH:MM" of an instant in the store's time zone, for date/time inputs. */
export function toLocalInputs(iso: string, timezone: string): { date: string; time: string } {
  const at = new Date(iso);
  return {
    date: at.toLocaleDateString("en-CA", { timeZone: timezone }),
    time: at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }),
  };
}
