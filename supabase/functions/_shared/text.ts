// Small text helpers for Discord messages.

/** Pitch dots: 1 red, 2 yellow, 3 blue, 4 purple; no pitch (weapons, heroes, tokens) a white dot. */
export function pitchEmoji(pitch: number | null | undefined): string {
  return ({ 1: "🔴", 2: "🟡", 3: "🔵", 4: "🟣" } as Record<number, string>)[pitch ?? 0] ?? "⚪";
}

/**
 * Player-supplied text (names, card names, labels) shown as plain text:
 * markdown characters are escaped and line breaks flattened, so nobody can
 * format, fake links or break the layout. Mentions are already off on every
 * message (allowed_mentions), this just keeps them from rendering as mentions.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/([\\*_~`|>#[\]()-])/g, "\\$1")
    .replace(/@/g, `@${ZERO_WIDTH_SPACE}`)
    .replace(/<(?=[@#:a/t])/g, `<${ZERO_WIDTH_SPACE}`);
}

export const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/** Cuts text to `max` characters, ending with "…" when cut. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Discord timestamp markup, rendered in each viewer's own time zone. */
export function discordTime(iso: string, style: "t" | "f" | "F" | "R" | "D" = "f"): string {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${style}>`;
}

/** "18:30" from "18:30" or "8:30"; null unless it's a valid 24-hour time. */
export function parsePostTime(input: string): string | null {
  const m = /^\s*([01]?\d|2[0-3])[:.]([0-5]\d)\s*$/.exec(input);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}
