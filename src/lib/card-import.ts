// Bulk "paste a list" import for requests. Parsing and preview-building are
// pure; name lookup happens in SQL (resolve_card_names).

import { cardLabel, type CardColor, type CardRow } from "./cards";
import { MAX_QUANTITY } from "./rules";

export const MAX_IMPORT_LINES = 200;

export type ParsedLine = { lineNo: number; raw: string; quantity: number; name: string; color: CardColor | null };
export type SkippedLine = { lineNo: number; raw: string; reason: string };

const COLOR_WORDS: Record<string, CardColor> = {
  red: "Red", r: "Red", "1": "Red",
  yellow: "Yellow", y: "Yellow", "2": "Yellow",
  blue: "Blue", b: "Blue", "3": "Blue",
};

/**
 * Parses lines like "3 Snatch", "3x Snatch", "Snatch x3", "Snatch" (= 1), with
 * an optional color: "Snatch (Blue)", "Snatch [b]", "Snatch - blue".
 * Blank lines, "#"/"//" comments, and leading bullets are ignored.
 */
export function parseCardList(text: string): { lines: ParsedLine[]; skipped: SkippedLine[] } {
  const lines: ParsedLine[] = [];
  const skipped: SkippedLine[] = [];

  text.split(/\r?\n/).forEach((original, i) => {
    const lineNo = i + 1;
    const raw = original.trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("//")) return;

    let rest = raw.replace(/^[-*•]\s+/, "");
    let quantity = 1;
    const leading = rest.match(/^(\d+)\s*[xX×]?\s+(.+)$/);
    const trailing = rest.match(/^(.+?)\s+[xX×]\s*(\d+)$/);
    if (leading) [quantity, rest] = [Number(leading[1]), leading[2]];
    else if (trailing) [rest, quantity] = [trailing[1], Number(trailing[2])];

    let color: CardColor | null = null;
    const colored = rest.match(/^(.*?)\s*(?:[([]\s*([a-z0-9]+)\s*[)\]]|\s[-–]\s*([a-z]+))\s*$/i);
    const colorWord = colored && (colored[2] ?? colored[3])?.toLowerCase();
    if (colored && colorWord && COLOR_WORDS[colorWord]) {
      color = COLOR_WORDS[colorWord];
      rest = colored[1];
    }

    const name = rest.trim();
    // A bare number ("3") is a quantity with no card, not a card named "3".
    if (!name || /^\d+$/.test(name)) skipped.push({ lineNo, raw, reason: "No card name" });
    else if (quantity < 1) skipped.push({ lineNo, raw, reason: "Quantity must be at least 1" });
    else lines.push({ lineNo, raw, quantity, name, color });
  });

  return { lines, skipped };
}

/**
 * Picks the version of a card to request. With a color given, that version (or
 * an error if it doesn't exist). Without one: the only version, or Red when a
 * card comes in several colors (falling back to the lowest pitch).
 */
export function chooseVariant(
  variants: CardRow[],
  color: CardColor | null,
): { card: CardRow; defaulted: boolean } | { reason: string } {
  if (variants.length === 0) return { reason: "Not found" };
  if (color) {
    const match = variants.find((v) => v.color === color);
    return match ? { card: match, defaulted: false } : { reason: `No ${color} version` };
  }
  if (variants.length === 1) return { card: variants[0], defaulted: false };
  const sorted = [...variants].sort((a, b) => (a.pitch ?? 0) - (b.pitch ?? 0));
  return { card: sorted.find((v) => v.color === "Red") ?? sorted[0], defaulted: true };
}

export type ImportItem = {
  card: CardRow;
  /** All versions of this card name, for switching color in the preview. */
  variants: CardRow[];
  quantity: number;
  /** Names as typed, when they differ from the catalog name (typo matches). */
  typedAs: string[];
  /** Picked Red because no color was given for a multi-color card. */
  defaultedToRed: boolean;
  /** Summed quantity exceeded MAX_QUANTITY and was capped. */
  capped: boolean;
};

export type Resolution = { name: string | null; match: "exact" | "typo" | null };

/**
 * Combines parsed lines, their resolved catalog names (same order), and every
 * version of each resolved name into the confirmation preview. Lines for the
 * same card are summed (capped at MAX_QUANTITY).
 */
export function buildImportPreview(
  lines: ParsedLine[],
  resolutions: Resolution[],
  variantsByName: Map<string, CardRow[]>,
): { items: ImportItem[]; skipped: SkippedLine[] } {
  const items = new Map<string, ImportItem>();
  const skipped: SkippedLine[] = [];

  lines.forEach((line, i) => {
    const res = resolutions[i];
    const variants = (res?.name && variantsByName.get(res.name)) || [];
    const choice = chooseVariant(variants, line.color);
    if ("reason" in choice) {
      skipped.push({ lineNo: line.lineNo, raw: line.raw, reason: choice.reason });
      return;
    }

    const existing = items.get(choice.card.id);
    const item: ImportItem = existing ?? {
      card: choice.card,
      variants: [...variants].sort((a, b) => (a.pitch ?? 0) - (b.pitch ?? 0)),
      quantity: 0,
      typedAs: [],
      defaultedToRed: false,
      capped: false,
    };
    item.quantity += line.quantity;
    if (item.quantity > MAX_QUANTITY) {
      item.quantity = MAX_QUANTITY;
      item.capped = true;
    }
    item.defaultedToRed ||= choice.defaulted;
    if (res?.match === "typo" && !item.typedAs.includes(line.name)) item.typedAs.push(line.name);
    items.set(choice.card.id, item);
  });

  return { items: [...items.values()], skipped };
}

/** Total copies in a preview, e.g. for "Request 13 cards". */
export function importCopies(items: Pick<ImportItem, "quantity">[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

/** Short label used in tests and summaries: "2× Boulder Drop (Red)". */
export function importItemLabel(item: Pick<ImportItem, "quantity" | "card">): string {
  return `${item.quantity}× ${cardLabel(item.card)}`;
}
