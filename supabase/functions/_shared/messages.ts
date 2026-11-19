// What ArmoryBot says when an RPC raises one of the SQL error codes. Mirrors
// ruleMessage() in src/lib/rules.ts for the codes the bot can hit (a test
// checks every code here also exists there), worded for Discord.

export const BOT_MESSAGES: Record<string, string> = {
  // Player identity
  discord_not_linked: "Connect your Discord to ArmoryPal first.",
  profile_incomplete: "Finish setting up your ArmoryPal profile first.",
  banned: "Your ArmoryPal account is suspended.",
  // Events
  event_not_found: "That event doesn't exist anymore.",
  event_ended: "This event has already ended.",
  event_cancelled: "This event was cancelled.",
  // Linking a server
  not_store_owner: "Only this store's owners (or ArmoryPal admins) can do that.",
  store_not_found: "That store doesn't exist. Pick one from the list.",
  store_not_linked: "That store isn't linked to this server.",
  store_required: "This server shows several stores. Pick one with the store option.",
  invalid_days_before: "Pick 0 to 6 days before the event.",
};

export const FALLBACK_MESSAGE = "Something went wrong. Try again in a moment.";

export function botMessage(code: string | undefined | null): string {
  return (code && BOT_MESSAGES[code]) || FALLBACK_MESSAGE;
}
