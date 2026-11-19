// The event post ArmoryBot keeps in a server's channel, Raid-Helper style:
// store and area, the event's name linking to ArmoryPal, a facts row, the
// Going list in three columns, players who left but kept requests, the top
// open requests, and Going / Not going / Requests / Open in ArmoryPal buttons.
// Pure: data in (bot_render_event), message out. Snapshot-tested.

import { buttonId } from "./custom-id.ts";
import { ButtonStyle, type ActionRow, type Embed, type EmbedField, type MessageData } from "./discord-types.ts";
import { formatLabel, isFormat } from "./formats.ts";
import { discordTime, escapeMarkdown, pitchEmoji, truncate, ZERO_WIDTH_SPACE } from "./text.ts";

/** What bot_render_event() returns. */
export type RenderData = {
  event: {
    id: string;
    label: string;
    event_date: string;
    starts_at: string;
    ends_at: string;
    cancelled_at: string | null;
    cancel_note: string | null;
    format: string | null;
    one_off: boolean;
    moved_from: string | null;
  };
  store: { id: string; name: string; city: string; region: string | null; country: string; timezone: string };
  going: { name: string; requests: number }[];
  not_going: { name: string; requests: number }[];
  open_requests: { card: string; pitch: number | null; remaining: number; requester: string }[];
  open_count: number;
  request_count: number;
  poll: { options: string[]; closed_at: string | null; weekly: boolean; votes: Record<string, number> } | null;
};

export type RenderOptions = {
  appUrl: string;
  now: Date;
  /** False once the server unlinked the store: last render, buttons off. */
  linked?: boolean;
};

export const POST_COLOR = 0x99c41e; // Noyama green, like the app's accent
export const POST_COLOR_INACTIVE = 0x8a8a8a;

// Discord's embed limits (docs.discord.com/developers/resources/message#embed-object-embed-limits).
export const LIMITS = { title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256, total: 6000 };

const OPEN_REQUESTS_SHOWN = 3;
const GOING_COLUMNS = 3;

export type PostState = { cancelled: boolean; ended: boolean; interactive: boolean };

export function postState(data: RenderData, opts: Pick<RenderOptions, "now" | "linked">): PostState {
  const cancelled = data.event.cancelled_at !== null;
  const ended = opts.now.getTime() >= new Date(data.event.ends_at).getTime();
  return { cancelled, ended, interactive: !cancelled && !ended && opts.linked !== false };
}

/** "New York, NY" — city plus region, or country when there's no region. */
export function storeArea(store: RenderData["store"]): string {
  return [store.city, store.region || store.country].filter(Boolean).join(", ");
}

/**
 * Lines that fit in `max` characters; if not all do, the last line becomes
 * "+N more in ArmoryPal" (linked), counting the lines left out.
 */
export function fitLines(lines: string[], max: number, moreUrl: string, extraHidden = 0): string {
  const more = (n: number) => `+${n} more in [ArmoryPal](${moreUrl})`;
  const out: string[] = [];
  let used = 0;
  for (const [i, line] of lines.entries()) {
    const hiddenIfStopHere = lines.length - i + extraHidden;
    const cost = line.length + (out.length ? 1 : 0);
    // Keep room for the "more" line unless this is the last line and nothing else is hidden.
    const reserve = i === lines.length - 1 && extraHidden === 0 ? 0 : more(hiddenIfStopHere).length + 1;
    if (used + cost + reserve > max) {
      out.push(more(hiddenIfStopHere));
      return out.join("\n");
    }
    out.push(line);
    used += cost;
  }
  if (extraHidden > 0) out.push(more(extraHidden));
  return out.join("\n");
}

function person(n: number, p: { name: string; requests: number }): string {
  return `${n}. ${escapeMarkdown(p.name)}${p.requests ? ` · ${p.requests} req` : ""}`;
}

function goingFields(data: RenderData, url: string): EmbedField[] {
  const total = data.going.length;
  if (!total) return [{ name: "Going (0)", value: "Nobody yet. Be the first!", inline: false }];
  // Column-major, in join order: 1–4 | 5–8 | 9–12 for 12 players.
  const perColumn = Math.ceil(total / GOING_COLUMNS);
  const columns = Array.from({ length: GOING_COLUMNS }, (_, c) =>
    data.going.slice(c * perColumn, (c + 1) * perColumn).map((p, i) => person(c * perColumn + i + 1, p)),
  ).filter((col) => col.length);
  // A column too long for one field ends with "+N more" (its own hidden players).
  return columns.map((col, c) => ({
    name: c === 0 ? `Going (${total})` : ZERO_WIDTH_SPACE,
    value: fitLines(col, LIMITS.fieldValue, url),
    inline: true,
  }));
}

function formatFact(data: RenderData, now: Date): string {
  if (data.event.format) return formatLabel(data.event.format);
  const poll = data.poll;
  if (poll && !poll.closed_at && now < new Date(data.event.starts_at)) {
    const votes = poll.options.filter(isFormat).map((code) => `${formatLabel(code)} ${poll.votes[code] ?? 0}`);
    return `Vote in ArmoryPal: ${votes.join(" · ")}`;
  }
  return "Not announced yet";
}

export function renderEventPost(data: RenderData, opts: RenderOptions): MessageData {
  const { event, store } = data;
  const state = postState(data, opts);
  const eventUrl = `${opts.appUrl}/events/${event.id}`;
  const requestsUrl = `${eventUrl}?tab=requests`;

  const notes: string[] = [];
  if (state.cancelled) {
    notes.push(`**Cancelled**${event.cancel_note ? `: ${escapeMarkdown(event.cancel_note)}` : ""}`);
  } else if (state.ended) {
    notes.push("This event has ended.");
  }
  if (event.moved_from && !state.cancelled) notes.push(`Moved from ${discordTime(event.moved_from, "f")}.`);
  if (event.one_off && !state.cancelled) notes.push("One-off event.");

  const fields: EmbedField[] = [
    { name: "📅 Date", value: discordTime(event.starts_at, "D"), inline: true },
    { name: "⏰ Time", value: discordTime(event.starts_at, "t"), inline: true },
    { name: "⏳ Starts", value: state.ended ? "Over" : discordTime(event.starts_at, "R"), inline: true },
    { name: "👥 Going", value: String(data.going.length), inline: true },
    { name: "🏷️ Format", value: truncate(formatFact(data, opts.now), LIMITS.fieldValue), inline: true },
    // Fills the second facts row so the Going columns start on a new line.
    { name: ZERO_WIDTH_SPACE, value: ZERO_WIDTH_SPACE, inline: true },
    ...goingFields(data, eventUrl),
  ];

  if (data.not_going.length) {
    fields.push({
      name: "Not going, kept requests",
      value: fitLines(
        data.not_going.map((p, i) => person(i + 1, p)),
        LIMITS.fieldValue,
        eventUrl,
      ),
    });
  }

  const shown = data.open_requests.slice(0, OPEN_REQUESTS_SHOWN).map(
    (r) => `${pitchEmoji(r.pitch)} · ${r.remaining}× ${escapeMarkdown(r.card)} · ${escapeMarkdown(r.requester)}`,
  );
  fields.push({
    name: `Open requests (${data.open_count})`,
    value: data.open_count
      ? fitLines(shown, LIMITS.fieldValue, requestsUrl, Math.max(0, data.open_count - shown.length))
      : "Nothing needed right now.",
  });

  const embed: Embed = {
    author: { name: truncate(`${store.name} · ${storeArea(store)}`, LIMITS.author), url: `${opts.appUrl}/stores/${store.id}` },
    title: truncate(`${state.cancelled ? "Cancelled · " : ""}${event.label}`, LIMITS.title),
    url: eventUrl,
    description: notes.length ? notes.join("\n") : undefined,
    color: state.cancelled || state.ended ? POST_COLOR_INACTIVE : POST_COLOR,
    fields,
    footer: { text: state.ended || opts.linked === false ? "ArmoryPal" : "ArmoryPal · updates live" },
  };

  // Going / Not going on the first row; the link to the app on its own row.
  // (Posts made before this change may still show a Requests button; its handler stays.)
  const off = !state.interactive;
  const components: ActionRow[] = [
    {
      type: 1,
      components: [
        { type: 2, style: ButtonStyle.SUCCESS, label: "Going", custom_id: buttonId("going", event.id), disabled: off },
        { type: 2, style: ButtonStyle.DANGER, label: "Not going", custom_id: buttonId("leave", event.id), disabled: off },
      ],
    },
    { type: 1, components: [{ type: 2, style: ButtonStyle.LINK, label: "Open in ArmoryPal", url: eventUrl }] },
  ];

  return { content: "", embeds: [fitEmbed(embed)], components, allowed_mentions: { parse: [] } };
}

/** Characters Discord counts toward the 6000 total. */
export function embedSize(e: Embed): number {
  return (
    (e.title?.length ?? 0) +
    (e.description?.length ?? 0) +
    (e.author?.name.length ?? 0) +
    (e.footer?.text.length ?? 0) +
    (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0)
  );
}

/**
 * Last-resort guard for the 6000-character and 25-field limits: shortens the
 * longest field (by halving it, keeping whole lines) until the embed fits.
 */
export function fitEmbed(embed: Embed): Embed {
  const fields = (embed.fields ?? []).slice(0, LIMITS.fields).map((f) => ({ ...f }));
  const e = { ...embed, fields };
  while (embedSize(e) > LIMITS.total) {
    const longest = fields.reduce((a, b) => (b.value.length > a.value.length ? b : a));
    const lines = longest.value.split("\n");
    if (lines.length <= 1) {
      longest.value = truncate(longest.value, Math.floor(longest.value.length / 2));
    } else {
      longest.value = [...lines.slice(0, Math.ceil(lines.length / 2)), "+more in ArmoryPal"].join("\n");
    }
  }
  return e;
}

/** A short, stable fingerprint of a rendered post (FNV-1a), to skip edits that change nothing. */
export function renderHash(message: MessageData): string {
  const text = JSON.stringify(message);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
