import type { CardColor } from "@/lib/cards";

// Expo 2025 palette via theme tokens (globals.css). Yellow gets a faint ring so it stays visible on white.
const DOT_CLASS: Record<CardColor, string> = {
  Red: "bg-pitch-red",
  Yellow: "bg-pitch-yellow ring-1 ring-black/15 ring-inset",
  Blue: "bg-pitch-blue",
  Purple: "bg-pitch-purple",
};

/** Colored pitch strip indicator; an empty ring for cards without pitch (heroes, equipment). */
export function PitchDot({ color }: { color: CardColor | null }) {
  return (
    <span
      aria-label={color ? `${color} pitch` : "No pitch"}
      className={`inline-block size-3 shrink-0 rounded-full ${color ? DOT_CLASS[color] : "ring-2 ring-border ring-inset"}`}
    />
  );
}
