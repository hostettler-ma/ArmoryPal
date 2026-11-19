// The slice of Discord's interaction API that ArmoryBot uses
// (docs.discord.com/developers/interactions/receiving-and-responding).
// Pure TypeScript: no Deno or Node APIs, so Vitest and the Edge Functions share it.

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
} as const;

export const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
} as const;

export const OptionType = {
  SUB_COMMAND: 1,
  STRING: 3,
  INTEGER: 4,
  CHANNEL: 7,
} as const;

export const ChannelType = { GUILD_TEXT: 0, GUILD_ANNOUNCEMENT: 5 } as const;

export const ButtonStyle = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4, LINK: 5 } as const;

/** Message flag: only the person who clicked sees the reply. */
export const EPHEMERAL = 1 << 6;

/** Permission bits (strings in payloads; parse as BigInt). */
export const Permission = {
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  MANAGE_GUILD: 1n << 5n,
  ADMINISTRATOR: 1n << 3n,
} as const;

export type CommandOption = {
  type: number;
  name: string;
  value?: string | number | boolean;
  focused?: boolean;
  options?: CommandOption[];
};

export type DiscordUser = { id: string; username?: string; global_name?: string | null };

export type Interaction = {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  /** In a server: the member who invoked it (with their permissions in this channel). */
  member?: { user: DiscordUser; nick?: string | null; permissions?: string };
  /** In a DM. */
  user?: DiscordUser;
  /** The bot's own permissions in this channel. */
  app_permissions?: string;
  data?: {
    name?: string;
    options?: CommandOption[];
    custom_id?: string;
    resolved?: { channels?: Record<string, { id: string; name?: string; type: number }> };
  };
  message?: { id: string; embeds?: { title?: string }[] };
};

export type Button = {
  type: 2;
  style: number;
  label: string;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
};

export type ActionRow = { type: 1; components: Button[] };

export type EmbedField = { name: string; value: string; inline?: boolean };

export type Embed = {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  author?: { name: string; url?: string };
  fields?: EmbedField[];
  footer?: { text: string };
};

export type MessageData = {
  content?: string;
  embeds?: Embed[];
  components?: ActionRow[];
  flags?: number;
  allowed_mentions?: { parse: string[] };
};

export type InteractionResponse =
  | { type: typeof ResponseType.PONG }
  | { type: typeof ResponseType.CHANNEL_MESSAGE_WITH_SOURCE | typeof ResponseType.UPDATE_MESSAGE; data: MessageData }
  | { type: typeof ResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE | typeof ResponseType.DEFERRED_UPDATE_MESSAGE; data?: { flags?: number } }
  | { type: typeof ResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT; data: { choices: { name: string; value: string }[] } };
