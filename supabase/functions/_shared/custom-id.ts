// Button custom_ids: "ap:<action>:<event uuid>" (at most 54 chars; Discord allows 100).
// Anyone can craft a click with any custom_id, so parsing is strict and every
// action re-checks everything in SQL.

export const BUTTON_ACTIONS = ["going", "leave", "leave-cancel", "leave-keep", "requests"] as const;
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function buttonId(action: ButtonAction, eventId: string): string {
  return `ap:${action}:${eventId}`;
}

export function parseButtonId(customId: string | undefined): { action: ButtonAction; eventId: string } | null {
  const m = /^ap:([a-z-]+):([0-9a-f-]{36})$/i.exec(customId ?? "");
  if (!m || !(BUTTON_ACTIONS as readonly string[]).includes(m[1]) || !isUuid(m[2])) return null;
  return { action: m[1] as ButtonAction, eventId: m[2].toLowerCase() };
}
