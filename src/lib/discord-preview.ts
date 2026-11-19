// The example ArmoryBot post on /discord-bot, drawn from the bot's real renderer
// (renderEventPost in supabase/functions/_shared) so it always matches what Discord shows.
// discordInline() turns the small Markdown subset the bot uses into pieces React can render.

import type { MessageData } from "../../supabase/functions/_shared/discord-types.ts";
import { renderEventPost, type RenderData } from "../../supabase/functions/_shared/render-event.ts";

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "time"; text: string };

const unescape = (s: string) => s.replace(/\\(.)/g, "$1");

/** Discord's <t:unix:style> timestamps, as a reader in `timeZone` sees them at `now`. */
export function discordTimestamp(unix: number, style: string, opts: { timeZone: string; now: Date }): string {
  const date = new Date(unix * 1000);
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: opts.timeZone, ...o }).format(date);
  switch (style) {
    case "t":
      return fmt({ timeStyle: "short" });
    case "D":
      return fmt({ dateStyle: "long" });
    case "R": {
      const minutes = (date.getTime() - opts.now.getTime()) / 60_000;
      const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
      if (Math.abs(minutes) < 60) return rtf.format(Math.round(minutes), "minute");
      if (Math.abs(minutes) < 60 * 24) return rtf.format(Math.round(minutes / 60), "hour");
      return rtf.format(Math.round(minutes / (60 * 24)), "day");
    }
    default:
      return fmt({ dateStyle: "long", timeStyle: "short" });
  }
}

/** Bold, links, timestamps and backslash escapes: the Markdown ArmoryBot's posts use. */
export function discordInline(src: string, opts: { timeZone: string; now: Date }): Inline[] {
  const out: Inline[] = [];
  const text = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.kind === "text") last.text += t;
    else out.push({ kind: "text", text: t });
  };
  const re = /\\(.)|\*\*((?:\\.|[^*])+?)\*\*|\[((?:\\.|[^\]])+)\]\((https?:\/\/[^)\s]+)\)|<t:(\d+):([a-zA-Z])>/g;
  let at = 0;
  for (const m of src.matchAll(re)) {
    text(src.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1] !== undefined) text(m[1]);
    else if (m[2] !== undefined) out.push({ kind: "bold", text: unescape(m[2]) });
    else if (m[3] !== undefined) out.push({ kind: "link", text: unescape(m[3]), href: m[4] });
    else out.push({ kind: "time", text: discordTimestamp(Number(m[5]), m[6], opts) });
  }
  text(src.slice(at));
  return out;
}

/** A Thursday a few days after EXAMPLE_NOW, 6:30 PM in Chicago. */
export const EXAMPLE_NOW = new Date("2026-11-24T16:00:00Z");
export const EXAMPLE_TIME_ZONE = "America/Chicago";

const EXAMPLE_DATA: RenderData = {
  event: {
    id: "00000000-0000-4000-a000-00000000e3a1",
    label: "Thursday Armory",
    event_date: "2026-11-26",
    starts_at: "2026-11-27T00:30:00Z",
    ends_at: "2026-11-27T06:00:00Z",
    cancelled_at: null,
    cancel_note: null,
    format: null,
    one_off: false,
    moved_from: null,
  },
  store: { id: "00000000-0000-4000-a000-00000000e3a2", name: "Dragonfire Games", city: "Springfield", region: "IL", country: "USA", timezone: EXAMPLE_TIME_ZONE },
  going: [
    { name: "Riley", requests: 0 },
    { name: "Sam", requests: 2 },
    { name: "Alex", requests: 1 },
    { name: "Jordan", requests: 2 },
    { name: "Casey", requests: 1 },
    { name: "Morgan", requests: 0 },
  ],
  not_going: [],
  open_requests: [
    { card: "Enlightened Strike (Red)", pitch: 1, remaining: 2, requester: "Jordan" },
    { card: "Pummel (Red)", pitch: 1, remaining: 2, requester: "Casey" },
    { card: "Snatch (Red)", pitch: 1, remaining: 1, requester: "Sam" },
  ],
  open_count: 4,
  request_count: 6,
  poll: { options: ["draft", "cc", "silver_age", "csp"], closed_at: null, weekly: true, votes: { cc: 3, draft: 1 } },
};

export const EXAMPLE_POST: MessageData = renderEventPost(EXAMPLE_DATA, { appUrl: "https://armorypal.vercel.app", now: EXAMPLE_NOW });
