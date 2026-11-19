// ArmoryBot's interaction handling: slash commands, autocomplete and buttons.
// Pure apart from the injected rpc, so it's unit-tested with a fake database.
// Every rule lives in SQL (bot_* RPCs); this file only routes and words replies.
// Every reply is ephemeral (only the clicker sees it) and never mentions anyone.

import { buttonId, isUuid, parseButtonId, type ButtonAction } from "./custom-id.ts";
import {
  ButtonStyle,
  EPHEMERAL,
  InteractionType,
  Permission,
  ResponseType,
  type ActionRow,
  type Button,
  type CommandOption,
  type Embed,
  type Interaction,
  type InteractionResponse,
  type MessageData,
} from "./discord-types.ts";
import type { Rpc, RpcError } from "./db.ts";
import { botMessage } from "./messages.ts";
import { discordTime, escapeMarkdown, parsePostTime, pitchEmoji, truncate } from "./text.ts";

export type Deps = { rpc: Rpc; appUrl: string; now?: () => Date };

const NO_MENTIONS = { parse: [] as string[] };
export const BRAND_COLOR = 0x99c41e;

// Replies ----------------------------------------------------------------------

function reply(content: string, extra: Omit<MessageData, "content" | "flags" | "allowed_mentions"> = {}): InteractionResponse {
  return {
    type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL, allowed_mentions: NO_MENTIONS, ...extra },
  };
}

/** Replaces the ephemeral message the button was on (the leave prompt). */
function update(content: string, components: ActionRow[] = []): InteractionResponse {
  return { type: ResponseType.UPDATE_MESSAGE, data: { content, components, embeds: [], allowed_mentions: NO_MENTIONS } };
}

const linkButton = (label: string, url: string): Button => ({ type: 2, style: ButtonStyle.LINK, label, url });
const row = (...components: Button[]): ActionRow => ({ type: 1, components });

/** An RPC failed: unlinked players get a way to connect, everything else the rule's message. */
function errorReply(error: RpcError, deps: Deps, asUpdate = false): InteractionResponse {
  const code = error.message;
  let content = botMessage(code);
  let components: ActionRow[] = [];
  if (code === "discord_not_linked") {
    content = "Connect your Discord to ArmoryPal to use these buttons. It takes a few seconds, then come back and tap again.";
    components = [row(linkButton("Connect Discord", `${deps.appUrl}/me#connected-accounts`))];
  } else if (code === "profile_incomplete") {
    components = [row(linkButton("Finish your profile", `${deps.appUrl}/welcome`))];
  } else if (!(code in BOT_CODES)) {
    console.error("bot rpc failed", error);
  }
  return asUpdate ? update(content, components) : reply(content, { components });
}

const BOT_CODES = Object.fromEntries(
  [
    "discord_not_linked",
    "profile_incomplete",
    "banned",
    "event_not_found",
    "event_ended",
    "event_cancelled",
    "not_store_owner",
    "store_not_found",
    "store_not_linked",
    "store_required",
    "invalid_days_before",
  ].map((c) => [c, true]),
);

// Helpers ----------------------------------------------------------------------

function invokerId(i: Interaction): string | undefined {
  return i.member?.user.id ?? i.user?.id;
}

function hasPermission(bits: string | undefined, flag: bigint): boolean {
  if (!bits || !/^\d+$/.test(bits)) return false;
  const value = BigInt(bits);
  return (value & Permission.ADMINISTRATOR) !== 0n || (value & flag) === flag;
}

function subcommand(i: Interaction): { name: string; options: Record<string, CommandOption> } | null {
  const sub = i.data?.options?.[0];
  if (!sub?.name) return null;
  return { name: sub.name, options: Object.fromEntries((sub.options ?? []).map((o) => [o.name, o])) };
}

const eventUrl = (deps: Deps, eventId: string, tab?: string) =>
  `${deps.appUrl}/events/${eventId}${tab ? `?tab=${tab}` : ""}`;

type StatusRow = {
  store_id: string;
  store: string;
  channel_id: string;
  days_before: number;
  post_time: string;
  broken_at: string | null;
  broken_reason: string | null;
  next_post: { event_id: string; label: string; starts_at: string; post_at: string } | null;
};

function describeLink(s: StatusRow, now: Date): string {
  const days = s.days_before === 0 ? "on the day" : s.days_before === 1 ? "1 day before" : `${s.days_before} days before`;
  const lines = [`**${escapeMarkdown(s.store)}** → <#${s.channel_id}> · posted ${days}, at ${s.post_time} store time`];
  if (s.broken_at) {
    lines.push(
      `⚠️ ArmoryBot can't post there (${escapeMarkdown(s.broken_reason ?? "no access")}). Fix the channel's permissions, or pick another channel with \`/armory settings\`.`,
    );
  } else if (s.next_post) {
    const when = new Date(s.next_post.post_at) <= now ? "within a minute" : discordTime(s.next_post.post_at, "R");
    lines.push(
      `Next: **${escapeMarkdown(s.next_post.label)}** on ${discordTime(s.next_post.starts_at, "f")}, posted ${when}.`,
    );
  } else {
    lines.push("No upcoming event to post yet.");
  }
  return lines.join("\n");
}

async function guildStatus(deps: Deps, guildId: string) {
  return deps.rpc<StatusRow[]>("bot_status", { p_guild_id: guildId });
}

// Slash commands ---------------------------------------------------------------

async function handleCommand(i: Interaction, deps: Deps): Promise<InteractionResponse> {
  const sub = subcommand(i);
  const guildId = i.guild_id;
  const userId = invokerId(i);
  if (!guildId || !userId || i.data?.name !== "armory" || !sub) return reply("Use this command in a server.");
  const now = deps.now?.() ?? new Date();
  // From the signed interaction: server managers can set ArmoryBot up without owning the store on ArmoryPal.
  const manageGuild = hasPermission(i.member?.permissions, Permission.MANAGE_GUILD);
  const str = (name: string) => {
    const v = sub.options[name]?.value;
    return typeof v === "string" ? v : undefined;
  };

  switch (sub.name) {
    case "link-store": {
      const storeId = str("store");
      if (!isUuid(storeId)) return reply("Pick a store from the list as you type its name.");
      const channelId = str("channel") ?? i.channel_id;
      if (!channelId) return reply("Pick a channel to post in.");
      const linked = await deps.rpc("bot_link_store", {
        p_discord_id: userId,
        p_guild_id: guildId,
        p_channel_id: channelId,
        p_store_id: storeId,
        p_has_manage_guild: manageGuild,
      });
      if (linked.error) return errorReply(linked.error, deps);

      const status = await guildStatus(deps, guildId);
      const mine = status.data?.find((s) => s.store_id === storeId);
      const lines = [mine ? `Linked! ${describeLink(mine, now)}` : "Linked!"];
      lines.push("Change the day, time or channel with `/armory settings`.");
      const canPostHere =
        channelId === i.channel_id &&
        hasPermission(i.app_permissions, Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES | Permission.EMBED_LINKS);
      if (!canPostHere) {
        lines.push(`Make sure ArmoryBot can view <#${channelId}>, send messages and embed links there.`);
      }
      return reply(lines.join("\n"));
    }

    case "settings": {
      const storeId = str("store");
      if (storeId !== undefined && !isUuid(storeId)) return reply("Pick a store from the list as you type its name.");
      const rawTime = str("post_time");
      const postTime = rawTime === undefined ? undefined : parsePostTime(rawTime);
      if (postTime === null) return reply("Use a 24-hour time like 10:00 or 18:30 (store time).");
      const daysBefore = sub.options.days_before?.value;
      const channelId = str("channel");

      const args: Record<string, unknown> = { p_discord_id: userId, p_guild_id: guildId, p_has_manage_guild: manageGuild };
      if (storeId) args.p_store_id = storeId;
      if (typeof daysBefore === "number") args.p_days_before = daysBefore;
      if (postTime) args.p_post_time = postTime;
      if (channelId) args.p_channel_id = channelId;
      const updated = await deps.rpc<{ store_id: string }>("bot_update_settings", args);
      if (updated.error) return errorReply(updated.error, deps);

      const status = await guildStatus(deps, guildId);
      const mine = status.data?.find((s) => s.store_id === updated.data.store_id);
      const changed = Object.keys(args).length > 3;
      return reply(`${changed ? "Saved." : "Current settings:"}\n${mine ? describeLink(mine, now) : ""}`.trim());
    }

    case "unlink": {
      const storeId = str("store");
      if (storeId !== undefined && !isUuid(storeId)) return reply("Pick a store from the list as you type its name.");
      const before = await guildStatus(deps, guildId);
      const unlinked = await deps.rpc<string>("bot_unlink_store", {
        p_discord_id: userId,
        p_guild_id: guildId,
        p_store_id: storeId ?? null,
        p_has_manage_guild: manageGuild,
      });
      if (unlinked.error) return errorReply(unlinked.error, deps);
      const name = before.data?.find((s) => s.store_id === unlinked.data)?.store;
      return reply(
        `Unlinked${name ? ` **${escapeMarkdown(name)}**` : ""}. ArmoryBot won't post its events here anymore, and posts already in the channel stop updating.`,
      );
    }

    case "status": {
      const status = await guildStatus(deps, guildId);
      if (status.error) return errorReply(status.error, deps);
      if (!status.data.length) return reply("No stores are linked to this server yet. Anyone with Manage Server can add one with `/armory link-store`.");
      return reply(truncate(status.data.map((s) => describeLink(s, now)).join("\n\n"), 1900));
    }
  }
  return reply("Unknown command.");
}

// Autocomplete -------------------------------------------------------------------

async function handleAutocomplete(i: Interaction, deps: Deps): Promise<InteractionResponse> {
  const empty: InteractionResponse = { type: ResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices: [] } };
  const sub = subcommand(i);
  const focused = sub && Object.values(sub.options).find((o) => o.focused);
  if (!sub || focused?.name !== "store") return empty;
  const query = String(focused.value ?? "").slice(0, 80);

  let choices: { name: string; value: string }[] = [];
  if (sub.name === "link-store") {
    const found = await deps.rpc<{ id: string; name: string; city: string; region: string | null }[]>("bot_search_stores", {
      p_query: query,
    });
    choices = (found.data ?? []).map((s) => ({
      name: truncate([s.name, [s.city, s.region].filter(Boolean).join(", ")].join(" · "), 100),
      value: s.id,
    }));
  } else if (i.guild_id) {
    // settings / unlink: only the stores this server has linked.
    const status = await guildStatus(deps, i.guild_id);
    const q = query.toLowerCase();
    choices = (status.data ?? [])
      .filter((s) => s.store.toLowerCase().includes(q))
      .map((s) => ({ name: truncate(s.store, 100), value: s.store_id }));
  }
  return { type: ResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices: choices.slice(0, 25) } };
}

// Buttons ---------------------------------------------------------------------------

type RequestRow = {
  id: string;
  card: string;
  pitch: number | null;
  quantity: number;
  pledged: number;
  my_pledge: number;
  requester: string;
  is_mine: boolean;
};

/** The Requests button: still-needed requests, others' first (what you can help with), then yours. */
export function requestsEmbed(rows: RequestRow[], openUrl: string): Embed {
  const open = rows
    .filter((r) => r.quantity > r.pledged)
    .sort((a, b) => Number(a.is_mine) - Number(b.is_mine));
  if (!open.length) return { title: "Open requests", description: "Nothing's needed right now. 🎉", color: BRAND_COLOR };

  const lines: string[] = [];
  let length = 0;
  for (const [index, r] of open.entries()) {
    const extras = [r.is_mine ? "you" : escapeMarkdown(r.requester)];
    if (r.my_pledge > 0) extras.push(`you're bringing ${r.my_pledge}`);
    const line = `${pitchEmoji(r.pitch)} ${r.quantity - r.pledged}× ${escapeMarkdown(r.card)} · ${extras.join(" · ")}`;
    const more = `+${open.length - index} more in [ArmoryPal](${openUrl})`;
    if (length + line.length + 1 + more.length > 3900) {
      lines.push(more);
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }
  return { title: `Open requests (${open.length})`, description: lines.join("\n"), color: BRAND_COLOR };
}

async function handleButton(i: Interaction, deps: Deps): Promise<InteractionResponse> {
  const parsed = parseButtonId(i.data?.custom_id);
  const userId = invokerId(i);
  if (!parsed || !userId) return reply("That button doesn't work anymore.");
  const { action, eventId } = parsed;
  const open = row(linkButton("Open in ArmoryPal", eventUrl(deps, eventId)));

  switch (action) {
    case "going": {
      const res = await deps.rpc("bot_attend", { p_discord_id: userId, p_event_id: eventId });
      if (res.error) return errorReply(res.error, deps);
      return reply("You're going! ✅ Add the cards you need, or offer to bring some, in ArmoryPal.", {
        components: [row(linkButton("Open in ArmoryPal", eventUrl(deps, eventId, "requests")))],
      });
    }

    case "leave": {
      const res = await deps.rpc<{ attending: boolean; requests: RequestRow[] }>("bot_event_requests", {
        p_discord_id: userId,
        p_event_id: eventId,
      });
      if (res.error) return errorReply(res.error, deps);
      const mine = res.data.requests.filter((r) => r.is_mine).length;
      const bringing = res.data.requests.filter((r) => r.my_pledge > 0).length;
      if (!res.data.attending) {
        return reply(
          mine
            ? `You're not on the Going list, but your ${plural(mine, "request")} still listed. Manage them in ArmoryPal.`
            : "You're not on the Going list.",
          { components: [open] },
        );
      }
      const lines = ["Not going after all?"];
      if (bringing) lines.push(`The ${plural(bringing, "card", false)} you offered to bring will be needed again.`);
      if (mine) {
        lines.push(`You have ${plural(mine, "request", false)} here. Do you still need those cards from someone else?`);
        return reply(lines.join(" "), {
          components: [
            row(
              { type: 2, style: ButtonStyle.DANGER, label: "Leave and cancel my requests", custom_id: buttonId("leave-cancel", eventId) },
              { type: 2, style: ButtonStyle.SECONDARY, label: "Leave, keep my requests", custom_id: buttonId("leave-keep", eventId) },
            ),
          ],
        });
      }
      return reply(lines.join(" "), {
        components: [row({ type: 2, style: ButtonStyle.DANGER, label: "Leave", custom_id: buttonId("leave-keep", eventId) })],
      });
    }

    case "leave-cancel":
    case "leave-keep": {
      const cancel = action === "leave-cancel";
      const res = await deps.rpc("bot_leave", { p_discord_id: userId, p_event_id: eventId, p_cancel_requests: cancel });
      if (res.error) return errorReply(res.error, deps, true);
      return update(
        cancel
          ? "You left the event and your requests were cancelled."
          : "You left the event. Any requests you had stay listed, marked \"Not going\".",
      );
    }

    case "requests": {
      const res = await deps.rpc<{ attending: boolean; requests: RequestRow[] }>("bot_event_requests", {
        p_discord_id: userId,
        p_event_id: eventId,
      });
      if (res.error) return errorReply(res.error, deps);
      const url = eventUrl(deps, eventId, "requests");
      return reply("", { embeds: [requestsEmbed(res.data.requests, url)], components: [row(linkButton("Open in ArmoryPal", url))] });
    }
  }
}

function plural(n: number, noun: string, withVerb = true): string {
  const word = `${n} ${noun}${n === 1 ? "" : "s"}`;
  return withVerb ? `${word} ${n === 1 ? "is" : "are"}` : word;
}

// Entry points -------------------------------------------------------------------------

/** Handles one verified interaction. Never throws: unexpected failures become a polite error. */
export async function handleInteraction(i: Interaction, deps: Deps): Promise<InteractionResponse> {
  try {
    switch (i.type) {
      case InteractionType.PING:
        return { type: ResponseType.PONG };
      case InteractionType.APPLICATION_COMMAND:
        return await handleCommand(i, deps);
      case InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE:
        return await handleAutocomplete(i, deps);
      case InteractionType.MESSAGE_COMPONENT:
        return await handleButton(i, deps);
    }
  } catch (e) {
    console.error("interaction failed", e);
    if (i.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
      return { type: ResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices: [] } };
    }
  }
  return reply(botMessage(null));
}

/** Leave-prompt buttons edit their own message; everything else replies. */
const UPDATING_ACTIONS: readonly ButtonAction[] = ["leave-cancel", "leave-keep"];

/**
 * What to send Discord if the handler is too slow for the 3-second window:
 * a "thinking…" placeholder that the handler's result later replaces
 * (PATCH …/messages/@original). Null when the interaction can't be deferred.
 */
export function deferredResponseFor(i: Interaction): InteractionResponse | null {
  if (i.type === InteractionType.APPLICATION_COMMAND) {
    return { type: ResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: EPHEMERAL } };
  }
  if (i.type === InteractionType.MESSAGE_COMPONENT) {
    const action = parseButtonId(i.data?.custom_id)?.action;
    return action && UPDATING_ACTIONS.includes(action)
      ? { type: ResponseType.DEFERRED_UPDATE_MESSAGE }
      : { type: ResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: EPHEMERAL } };
  }
  return null;
}

/** The message body to PATCH onto @original after a deferral. */
export function followUpBody(res: InteractionResponse): MessageData {
  return "data" in res && res.data && "allowed_mentions" in res.data
    ? { ...(res.data as MessageData), flags: undefined }
    : { content: botMessage(null), allowed_mentions: NO_MENTIONS };
}
