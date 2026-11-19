// ArmoryBot's slash commands, registered by scripts/register-discord-commands.mts
// (PUT /applications/{id}/commands, which replaces the whole set).

import { ChannelType, OptionType, Permission } from "./discord-types.ts";

const storeOption = (required: boolean, description: string) => ({
  type: OptionType.STRING,
  name: "store",
  description,
  required,
  autocomplete: true,
});

const channelOption = (description: string) => ({
  type: OptionType.CHANNEL,
  name: "channel",
  description,
  required: false,
  channel_types: [ChannelType.GUILD_TEXT, ChannelType.GUILD_ANNOUNCEMENT],
});

export const COMMANDS = [
  {
    name: "armory",
    description: "Show a store's ArmoryPal events in this server",
    type: 1,
    // Manage Server by default; server admins can change who sees it under Integrations.
    default_member_permissions: Permission.MANAGE_GUILD.toString(),
    // Servers only (guild install, guild context).
    integration_types: [0],
    contexts: [0],
    options: [
      {
        type: OptionType.SUB_COMMAND,
        name: "link-store",
        description: "Post a store's Armory events in a channel",
        options: [storeOption(true, "The store"), channelOption("Where to post (default: this channel)")],
      },
      {
        type: OptionType.SUB_COMMAND,
        name: "settings",
        description: "When and where events are posted",
        options: [
          storeOption(false, "Which linked store (needed if the server shows several)"),
          { type: OptionType.INTEGER, name: "days_before", description: "Post this many days before the event (0–6)", min_value: 0, max_value: 6 },
          { type: OptionType.STRING, name: "post_time", description: "Time to post, 24-hour store time, e.g. 10:00", max_length: 5 },
          channelOption("Post in this channel instead"),
        ],
      },
      {
        type: OptionType.SUB_COMMAND,
        name: "unlink",
        description: "Stop posting a store's events here",
        options: [storeOption(false, "Which linked store (needed if the server shows several)")],
      },
      { type: OptionType.SUB_COMMAND, name: "status", description: "What's linked and when the next post goes out" },
    ],
  },
] as const;
