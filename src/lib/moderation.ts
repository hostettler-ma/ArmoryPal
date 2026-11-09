/** Mirrors the reason checks in *_admin_moderation.sql (admin_ban, admin_remove_attendee). */
export const MAX_REASON_LENGTH = 200;

export type ReasonCheck = { ok: true; value: string } | { ok: false; error: string };

/** Trims a moderation reason. Ban reasons are required; removal reasons are optional. */
export function parseReason(input: unknown, { required }: { required: boolean }): ReasonCheck {
  const value = typeof input === "string" ? input.trim() : "";
  if (required && !value) return { ok: false, error: "Give a reason." };
  if (value.length > MAX_REASON_LENGTH) return { ok: false, error: `Keep it to ${MAX_REASON_LENGTH} characters.` };
  return { ok: true, value };
}

/** What admin_delete_store will do: stores with any event are archived, others deleted. */
export function deleteStoreOutcome(eventCount: number): "archive" | "delete" {
  return eventCount > 0 ? "archive" : "delete";
}

/** Labels for admin_actions.action, for the admin log. */
export const ADMIN_ACTION_LABELS: Record<string, string> = {
  remove_attendee: "Removed from event",
  ban: "Banned",
  unban: "Unbanned",
  archive_store: "Archived store",
  restore_store: "Restored store",
  delete_store: "Deleted store",
  approve_owner: "Approved store owner",
  reject_owner: "Rejected store owner",
  remove_owner: "Removed store owner",
};
