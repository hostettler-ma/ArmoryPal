/** Mirrors the message check in *_store_owners.sql (request_store_ownership). */
export const MAX_OWNERSHIP_MESSAGE = 200;

export type MessageCheck = { ok: true; value: string } | { ok: false; error: string };

/** Trims the optional "how do you run this store?" message. */
export function parseOwnershipMessage(input: unknown): MessageCheck {
  const value = typeof input === "string" ? input.trim() : "";
  if (value.length > MAX_OWNERSHIP_MESSAGE) {
    return { ok: false, error: `Keep it to ${MAX_OWNERSHIP_MESSAGE} characters.` };
  }
  return { ok: true, value };
}

export type OwnershipState = "owner" | "pending" | "none";

/** What the store page offers the viewer: Manage, "Request pending", or "I run this store". */
export function ownershipState(isOwner: boolean, hasPendingRequest: boolean): OwnershipState {
  if (isOwner) return "owner";
  return hasPendingRequest ? "pending" : "none";
}
