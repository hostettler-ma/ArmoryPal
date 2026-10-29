import type { CardColor } from "@/lib/cards";

const DOT_CLASS: Record<CardColor, string> = {
  Red: "bg-red-600",
  Yellow: "bg-yellow-400",
  Blue: "bg-blue-600",
};

/** Colored pitch strip indicator; an empty ring for cards without pitch (heroes, equipment). */
export function PitchDot({ color }: { color: CardColor | null }) {
  return (
    <span
      aria-label={color ? `${color} pitch` : "No pitch"}
      className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full ${color ? DOT_CLASS[color] : "ring-2 ring-border ring-inset"}`}
    />
  );
}
