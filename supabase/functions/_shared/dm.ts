// One Discord DM per player per batch: everything queued for them in the last
// couple of minutes, grouped by event, with a link to each event's Requests
// tab. Pure: batch in (bot_claim_dm_batches), message out. Unit-tested.

import { ButtonStyle, type Button, type MessageData } from "./discord-types.ts";
import { discordTime, escapeMarkdown, truncate } from "./text.ts";

export type DmPayload = {
  actor?: string;
  card?: string;
  items?: number;
  copies?: number;
  reason?: "unpledged" | "left_event" | "removed" | string;
};

export type DmItem = {
  id: number;
  kind: "new_requests" | "card_needed_again" | string;
  payload: DmPayload;
  created_at: string;
  event: { id: string; label: string; starts_at: string; store: string };
};

export type DmBatch = { user_id: string; discord_id: string; items: DmItem[] };

/** Discord's message content limit. */
const MAX_CONTENT = 2000;
/** One row of link buttons: up to 4 events plus Notification settings. */
const MAX_EVENT_BUTTONS = 4;

type Merged = { kind: string; actor: string; reason?: string; card: string; items: number; copies: number };

/** Same actor, same kind (and reason) on the same event: one line ("Alice needs 5 cards: …"). */
function merge(items: DmItem[]): Merged[] {
  const out: Merged[] = [];
  for (const { kind, payload } of items) {
    const actor = payload.actor || "Someone";
    const reason = kind === "card_needed_again" ? (payload.reason ?? "unpledged") : undefined;
    const n = payload.items ?? 1;
    const copies = payload.copies ?? n;
    const same = out.find((m) => m.kind === kind && m.actor === actor && m.reason === reason);
    if (same) {
      same.items += n;
      same.copies += copies;
    } else {
      out.push({ kind, actor, reason, card: payload.card || "a card", items: n, copies });
    }
  }
  return out;
}

/** One line of the DM, in the same words as the in-app notification. */
export function dmLine(m: Merged): string {
  const actor = escapeMarkdown(m.actor);
  const card = escapeMarkdown(m.card);
  const more = m.items > 1 ? ` and ${m.items - 1} more` : "";
  if (m.kind === "new_requests") {
    return m.items > 1 ? `${actor} needs ${m.copies} cards: ${card}${more}.` : `${actor} needs ${m.copies}× ${card}.`;
  }
  const what = m.items > 1 ? `${m.copies} cards are needed again: ${card}${more}` : `${m.copies}× ${card} is needed again`;
  if (m.reason === "left_event") return `${actor} can't make it anymore, so ${what}.`;
  if (m.reason === "removed") return `${actor} was removed from the event, so ${what}.`;
  return m.items > 1
    ? `${actor} can't bring ${m.copies} cards anymore (${card}${more}). They're needed again.`
    : `${actor} can't bring ${m.copies}× ${card} anymore. It's needed again.`;
}

export function batchDms(batch: DmBatch, appUrl: string): MessageData {
  // Group by event, keeping the order the database sent (by event start).
  const events = new Map<string, { event: DmItem["event"]; items: DmItem[] }>();
  for (const item of batch.items) {
    const group = events.get(item.event.id) ?? { event: item.event, items: [] };
    group.items.push(item);
    events.set(item.event.id, group);
  }

  const footer = "-# You turned on Discord DMs in ArmoryPal. Turn them off in Notification settings.";
  const blocks: string[] = [];
  let used = footer.length;
  const groups = [...events.values()];
  for (const [i, { event, items }] of groups.entries()) {
    const block = [
      `**${escapeMarkdown(event.label)}** at ${escapeMarkdown(event.store)} · ${discordTime(event.starts_at, "f")}`,
      ...merge(items).map((m) => `• ${dmLine(m)}`),
    ].join("\n");
    const rest = groups.length - i;
    const moreLine = `…and updates for ${rest} more ${rest === 1 ? "event" : "events"} in ArmoryPal.`;
    if (used + block.length + 2 + (i < groups.length - 1 ? moreLine.length + 2 : 0) > MAX_CONTENT) {
      blocks.push(blocks.length ? moreLine : truncate(block, MAX_CONTENT - used - 2));
      break;
    }
    blocks.push(block);
    used += block.length + 2;
  }

  const buttons: Button[] = groups.slice(0, MAX_EVENT_BUTTONS).map(({ event }) => ({
    type: 2,
    style: ButtonStyle.LINK,
    label: truncate(groups.length === 1 ? "See the requests" : `Requests · ${event.label}`, 80),
    url: `${appUrl}/events/${event.id}?tab=requests`,
  }));
  buttons.push({ type: 2, style: ButtonStyle.LINK, label: "Notification settings", url: `${appUrl}/settings/notifications` });

  return {
    content: [...blocks, footer].join("\n\n"),
    components: [{ type: 1, components: buttons }],
    allowed_mentions: { parse: [] },
  };
}
