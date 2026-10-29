export type CardColor = "Red" | "Yellow" | "Blue";

export type CardRow = {
  id: string;
  name: string;
  pitch: number | null;
  color: CardColor | null;
  types: string[];
  image_url: string | null;
};

/** Subset of a fab-cube `json/english/card.json` entry that we import. */
export type FabCubeCard = {
  unique_id: string;
  name: string;
  pitch: string;
  color: string;
  types: string[];
  printings: { set_id: string; image_url: string | null }[];
};

/** Subset of a fab-cube `json/english/set.json` entry. */
export type FabCubeSet = {
  id: string;
  name: string;
  printings: { initial_release_date: string | null }[];
};

/**
 * Sets with at least this many distinct cards count as expansions. Main sets
 * have 250+; Armory/demo/Silver Age decks and mastery packs stay well below.
 */
export const EXPANSION_MIN_CARDS = 150;

export type LatestSet = { id: string; name: string; releasedOn: string | null };

/**
 * The most recently released expansion (by its earliest edition's release
 * date) that has cards in the dataset, or null if none qualify.
 */
export function latestExpansion(cards: FabCubeCard[], sets: FabCubeSet[]): LatestSet | null {
  const cardsPerSet = new Map<string, number>();
  for (const card of cards) {
    for (const setId of new Set(card.printings.map((p) => p.set_id))) {
      cardsPerSet.set(setId, (cardsPerSet.get(setId) ?? 0) + 1);
    }
  }

  let best: LatestSet | null = null;
  for (const set of sets) {
    if ((cardsPerSet.get(set.id) ?? 0) < EXPANSION_MIN_CARDS) continue;
    const released = set.printings
      .map((p) => p.initial_release_date?.slice(0, 10))
      .filter((d): d is string => !!d)
      .sort()[0];
    if (!released) continue;
    if (!best || released > best.releasedOn!) best = { id: set.id, name: set.name, releasedOn: released };
  }
  return best;
}

const COLORS: readonly string[] = ["Red", "Yellow", "Blue"];

/** Maps a fab-cube card to a `cards` row, or throws if the entry is malformed. */
export function toCardRow(card: FabCubeCard): CardRow {
  if (!card.unique_id || !card.name?.trim()) throw new Error(`Card missing id or name: ${JSON.stringify(card).slice(0, 120)}`);
  const pitch = card.pitch === "" ? null : Number(card.pitch);
  if (pitch !== null && ![1, 2, 3].includes(pitch)) throw new Error(`Unexpected pitch "${card.pitch}" on ${card.name}`);
  return {
    id: card.unique_id,
    name: card.name.trim(),
    pitch,
    color: COLORS.includes(card.color) ? (card.color as CardColor) : null,
    types: card.types,
    image_url: card.printings.find((p) => p.image_url)?.image_url ?? null,
  };
}

/** All pitch variants of one card name, as shown in a single autocomplete entry. */
export type CardGroup = { name: string; types: string[]; variants: CardRow[] };

/**
 * Groups `search_cards` rows by name, keeping the order names first appear in
 * (the RPC's rank) and sorting variants Red → Yellow → Blue.
 */
export function groupCards(rows: CardRow[]): CardGroup[] {
  const groups = new Map<string, CardGroup>();
  for (const row of rows) {
    const group = groups.get(row.name);
    if (group) group.variants.push(row);
    else groups.set(row.name, { name: row.name, types: row.types, variants: [row] });
  }
  for (const g of groups.values()) g.variants.sort((a, b) => (a.pitch ?? 0) - (b.pitch ?? 0));
  return [...groups.values()];
}

/** "2026-06-05" → "June 2026". */
export function formatReleaseMonth(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "Snatch (Red)", or just "Fyendal's Spring Tunic" for cards without a pitch color. */
export function cardLabel(card: Pick<CardRow, "name" | "color">): string {
  return card.color ? `${card.name} (${card.color})` : card.name;
}
