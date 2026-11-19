// Discord REST calls shared by the functions. Phase 3 adds the rate-limited
// client for posts and DMs; Phase 2 only edits deferred interaction replies,
// which use the interaction token (no bot token, not bound by the global limit).

import type { MessageData } from "./discord-types.ts";

export const DISCORD_API = "https://discord.com/api/v10";

/** Replaces the deferred "thinking…" reply (or the deferred-updated message) with the real one. */
export async function editOriginalResponse(
  appId: string,
  token: string,
  body: MessageData,
  doFetch: typeof fetch = fetch,
): Promise<boolean> {
  const res = await doFetch(`${DISCORD_API}/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error("editing the deferred reply failed", res.status, await res.text());
  return res.ok;
}
