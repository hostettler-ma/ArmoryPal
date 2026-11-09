// Business rules for requests and pledges. These mirror the checks in the SQL
// functions (supabase/migrations/*_requests_pledges.sql), which are the source
// of truth; this copy drives the UI (what to show/enable) and is unit-tested.
// Change both together.

export const MAX_QUANTITY = 20;
export const MAX_NOTE_LENGTH = 200;

export type Coverage = "open" | "partial" | "covered";

export type RuleError =
  | "event_ended"
  | "event_not_found"
  | "not_signed_in"
  | "not_attending"
  | "own_request"
  | "request_cancelled"
  | "request_not_found"
  | "not_owner"
  | "invalid_quantity"
  | "exceeds_remaining"
  | "below_pledged"
  | "note_too_long"
  | "no_items"
  | "card_not_found"
  | "invalid_copy"
  // Moderation (admin RPCs in *_admin_moderation.sql).
  | "banned"
  | "not_admin"
  | "invalid_reason"
  | "reason_too_long"
  | "user_not_found"
  | "cannot_ban_self"
  | "cannot_ban_admin"
  | "already_banned"
  | "not_banned"
  | "store_not_found"
  | "store_not_archived"
  // Store owners (*_store_owners.sql).
  | "not_store_owner"
  | "already_owner"
  | "request_pending"
  | "message_too_long"
  | "ownership_request_not_found"
  // Event management (*_event_management.sql; mirrored in src/lib/event-manage.ts).
  | "invalid_label"
  | "invalid_gem_link"
  | "invalid_ticket_link"
  | "move_in_past"
  | "move_too_far"
  | "date_in_past"
  | "too_far_ahead"
  | "invalid_schedule"
  | "schedule_not_found"
  | "notes_too_long"
  // Format polls (*_format_polls.sql; mirrored in src/lib/formats.ts).
  | "no_poll"
  | "poll_closed"
  | "invalid_format"
  | "not_in_audience"
  | "invalid_poll_options"
  | "poll_exists"
  | "poll_has_votes";

export type Check = { ok: true } | { ok: false; reason: RuleError };
const ok: Check = { ok: true };
const fail = (reason: RuleError): Check => ({ ok: false, reason });

export function totalPledged(pledges: { quantity: number }[]): number {
  return pledges.reduce((sum, p) => sum + p.quantity, 0);
}

export function coverage(quantity: number, pledged: number): Coverage {
  if (pledged <= 0) return "open";
  return pledged >= quantity ? "covered" : "partial";
}

/** Context about the viewer and a request, as needed by the checks below. */
export type PledgeContext = {
  eventEnded: boolean;
  viewerAttending: boolean;
  viewerIsRequester: boolean;
  requestActive: boolean;
  requestQuantity: number;
  /** All pledges on the request, including the viewer's. */
  pledged: number;
  /** The viewer's current pledge (0 if none). */
  myPledge: number;
};

/** Largest quantity the viewer may pledge (replacing their existing pledge). */
export function maxPledge(ctx: Pick<PledgeContext, "requestQuantity" | "pledged" | "myPledge">): number {
  return Math.max(0, ctx.requestQuantity - (ctx.pledged - ctx.myPledge));
}

/** May the viewer pledge for this request at all? */
export function canPledge(ctx: PledgeContext): Check {
  if (ctx.eventEnded) return fail("event_ended");
  if (!ctx.viewerAttending) return fail("not_attending");
  if (!ctx.requestActive) return fail("request_cancelled");
  if (ctx.viewerIsRequester) return fail("own_request");
  if (maxPledge(ctx) < 1) return fail("exceeds_remaining");
  return ok;
}

/** May the viewer pledge exactly `quantity`? */
export function checkPledgeQuantity(ctx: PledgeContext, quantity: number): Check {
  const base = canPledge(ctx);
  if (!base.ok) return base;
  if (!Number.isInteger(quantity) || quantity < 1) return fail("invalid_quantity");
  if (quantity > maxPledge(ctx)) return fail("exceeds_remaining");
  return ok;
}

export function canAddRequest(ctx: { eventEnded: boolean; viewerAttending: boolean }): Check {
  if (ctx.eventEnded) return fail("event_ended");
  if (!ctx.viewerAttending) return fail("not_attending");
  return ok;
}

export function checkRequestQuantity(quantity: number): Check {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY ? ok : fail("invalid_quantity");
}

/** Requesters may change quantity, but not below what others already pledged. */
export function checkRequestUpdate(
  ctx: { eventEnded: boolean; viewerIsRequester: boolean; requestActive: boolean; pledged: number },
  quantity: number,
): Check {
  if (ctx.eventEnded) return fail("event_ended");
  if (!ctx.viewerIsRequester) return fail("not_owner");
  if (!ctx.requestActive) return fail("request_cancelled");
  const q = checkRequestQuantity(quantity);
  if (!q.ok) return q;
  if (quantity < ctx.pledged) return fail("below_pledged");
  return ok;
}

const MESSAGES: Record<RuleError, string> = {
  event_ended: "This event has already ended.",
  event_not_found: "That event doesn't exist.",
  not_signed_in: "Please sign in again.",
  not_attending: "Mark yourself as going first.",
  own_request: "You can't bring cards for your own request.",
  request_cancelled: "That request was cancelled.",
  request_not_found: "That request doesn't exist anymore.",
  not_owner: "Only the requester can change this.",
  invalid_quantity: `Pick a quantity between 1 and ${MAX_QUANTITY}.`,
  exceeds_remaining: "That's more than is still needed. Someone may have just pledged; check again.",
  below_pledged: "Others already pledged more than that. Ask them to lower their pledge first.",
  note_too_long: `Keep the note to ${MAX_NOTE_LENGTH} characters.`,
  no_items: "Pick at least one card.",
  card_not_found: "That card isn't in the catalog.",
  invalid_copy: "Requests can only be copied from last week's event of the same slot.",
  banned: "Your account is suspended.",
  not_admin: "Only admins can do that.",
  invalid_reason: "Give a reason (up to 200 characters).",
  reason_too_long: "Keep the reason to 200 characters.",
  user_not_found: "That player doesn't exist.",
  cannot_ban_self: "You can't ban yourself.",
  cannot_ban_admin: "Admins can't be banned. Remove their admin rights first.",
  already_banned: "That player is already banned.",
  not_banned: "That player isn't banned.",
  store_not_found: "That store doesn't exist.",
  store_not_archived: "That store isn't archived.",
  not_store_owner: "Only this store's owners can do that.",
  already_owner: "You already manage this store.",
  request_pending: "Your request is already waiting for an admin.",
  message_too_long: "Keep the message to 200 characters.",
  ownership_request_not_found: "That request was already handled.",
  invalid_label: "Give the event a name (up to 40 characters).",
  invalid_gem_link: "Use an https link on gem.fabtcg.com, or just the event code.",
  invalid_ticket_link: "Use a full https:// link to your ticket page.",
  move_in_past: "Pick a time that hasn't passed yet.",
  move_too_far: "A weekly event can move by up to 6 days. To change every week, edit the weekly slot.",
  date_in_past: "That day is already over.",
  too_far_ahead: "Events can be planned up to 90 days ahead.",
  invalid_schedule: "Pick a weekday and a start time.",
  schedule_not_found: "That weekly slot doesn't exist.",
  notes_too_long: "Keep the notes to 500 characters.",
  no_poll: "There's no format poll for this event.",
  poll_closed: "Voting has closed for this event.",
  invalid_format: "Pick one of the formats on the poll.",
  not_in_audience: "Mark yourself as going, or save the store, to vote.",
  invalid_poll_options: "Pick at least two formats to vote on.",
  poll_exists: "This event already has a poll.",
  poll_has_votes: "People already voted, so the poll can't be removed. Confirm a format instead.",
};

/** Friendly text for an error code raised by the SQL functions (or a Check). */
export function ruleMessage(codeOrMessage: string | undefined): string {
  return (codeOrMessage && MESSAGES[codeOrMessage as RuleError]) || "Something went wrong. Try again.";
}
