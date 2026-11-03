/** Payload written by the SQL functions (see *_notification* migrations). */
export type NotificationPayload = {
  card?: string;
  quantity?: number;
  actor?: string;
  reason?: "unpledged" | "left_event" | "cancelled" | "removed";
  /** removed_from_event: the admin's optional reason. */
  note?: string;
  /** new_requests, card_needed_again: distinct cards and total copies in one add or release. */
  items?: number;
  copies?: number;
  /** requests_filled: how many requests (and copies) are now all covered. */
  requests?: number;
};

/** Every notification kind, in the order shown on the settings page. Keep in sync with the SQL check constraint. */
export const NOTIFICATION_KINDS = [
  {
    kind: "new_requests",
    label: "New requests",
    description: "Someone asks for cards at an event you're going to or a store you saved.",
  },
  {
    kind: "card_needed_again",
    label: "Cards needed again",
    description: "Someone can't bring cards they promised, at an event you're going to or a store you saved.",
  },
  {
    kind: "requests_filled",
    label: "All my requests covered",
    description: "Everything you asked for has someone bringing it.",
  },
  {
    kind: "pledge_released",
    label: "A card I need is needed again",
    description: "Someone who promised you a card can't bring it anymore.",
  },
  {
    kind: "request_cancelled",
    label: "No need to bring a card",
    description: "A request you promised to bring for was cancelled.",
  },
  {
    kind: "removed_from_event",
    label: "Removed from an event",
    description: "An admin took you off an event's Going list.",
  },
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]["kind"];

/** One-line message for a notification. */
export function formatNotification(kind: string, payload: NotificationPayload): string {
  const actor = payload.actor || "Someone";
  const card = payload.card || "a card";
  const copies = (n = payload.quantity) => `${n ?? 1}× ${card}`;

  if (kind === "pledge_released") {
    if (payload.reason === "removed") return `${actor} was removed from the event, so ${copies()} is needed again.`;
    return payload.reason === "left_event"
      ? `${actor} can't make it anymore, so ${copies()} is needed again.`
      : `${actor} can no longer bring ${copies()}. It's needed again.`;
  }
  if (kind === "request_cancelled") {
    if (payload.reason === "removed") {
      return `${actor} was removed from the event, so their request for ${card} is cancelled. You don't need to bring ${copies()}.`;
    }
    return payload.reason === "left_event"
      ? `${actor} isn't going anymore and cancelled their request for ${card}. You don't need to bring ${copies()}.`
      : `${actor} no longer needs ${card}. You don't need to bring ${copies()}.`;
  }
  if (kind === "new_requests") {
    const items = payload.items ?? 1;
    return items > 1
      ? `${actor} needs ${payload.copies ?? items} cards: ${card} and ${items - 1} more.`
      : `${actor} needs ${copies(payload.copies)}.`;
  }
  if (kind === "card_needed_again") {
    const items = payload.items ?? 1;
    const n = payload.copies ?? items;
    const what = items > 1 ? `${n} cards are needed again: ${card} and ${items - 1} more` : `${copies(n)} is needed again`;
    if (payload.reason === "left_event") return `${actor} can't make it anymore, so ${what}.`;
    if (payload.reason === "removed") return `${actor} was removed from the event, so ${what}.`;
    return `${copies(n)} is needed again: ${actor} can't bring it anymore.`;
  }
  if (kind === "removed_from_event") {
    return `An admin removed you from this event.${payload.note ? ` Reason: ${payload.note}` : ""}`;
  }
  if (kind === "requests_filled") {
    const n = payload.requests ?? 1;
    return n > 1
      ? `All ${n} of your requests are covered. Someone is bringing every card you asked for.`
      : "Your request is covered. Someone is bringing the card you asked for.";
  }
  return "Something changed in one of your events.";
}

/** "just now", "5 min ago", "3 h ago", or a short date. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
