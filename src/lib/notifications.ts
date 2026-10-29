/** Payload written by the SQL functions (see *_notification* migrations). */
export type NotificationPayload = {
  card?: string;
  quantity?: number;
  actor?: string;
  reason?: "unpledged" | "left_event" | "cancelled";
  /** new_requests: distinct cards and total copies in one add. */
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
    description: "Someone going to the same event asks for cards.",
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
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]["kind"];

/** One-line message for a notification. */
export function formatNotification(kind: string, payload: NotificationPayload): string {
  const actor = payload.actor || "Someone";
  const card = payload.card || "a card";
  const copies = (n = payload.quantity) => `${n ?? 1}× ${card}`;

  if (kind === "pledge_released") {
    return payload.reason === "left_event"
      ? `${actor} can't make it anymore, so ${copies()} is needed again.`
      : `${actor} can no longer bring ${copies()}. It's needed again.`;
  }
  if (kind === "request_cancelled") {
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
