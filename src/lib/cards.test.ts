import { describe, expect, it } from "vitest";
import {
  cardLabel,
  cardSetIds,
  formatSetIds,
  setInfo,
  EXPANSION_MIN_CARDS,
  formatReleaseMonth,
  groupCards,
  latestExpansion,
  toCardRow,
  type CardRow,
  type FabCubeCard,
  type FabCubeSet,
} from "./cards";

const base: FabCubeCard = {
  unique_id: "abc123",
  name: "Snatch",
  pitch: "1",
  color: "Red",
  types: ["Generic", "Action", "Attack"],
  printings: [
    { set_id: "WTR", image_url: null },
    { set_id: "WTR", image_url: "https://img/1.png" },
    { set_id: "1HP", image_url: "https://img/2.png" },
  ],
};

describe("toCardRow", () => {
  it("maps pitch to a number and keeps the color", () => {
    expect(toCardRow(base)).toEqual({
      id: "abc123",
      name: "Snatch",
      pitch: 1,
      color: "Red",
      types: ["Generic", "Action", "Attack"],
      image_url: "https://img/1.png",
      set_ids: ["1HP", "WTR"], // no release dates given → alphabetical
    });
  });

  it("uses null pitch and color for heroes and equipment", () => {
    const row = toCardRow({ ...base, name: "Fyendal's Spring Tunic", pitch: "", color: "", types: ["Generic", "Equipment"] });
    expect(row.pitch).toBeNull();
    expect(row.color).toBeNull();
  });

  it("has a null image when no printing has one", () => {
    expect(toCardRow({ ...base, printings: [{ set_id: "WTR", image_url: null }] }).image_url).toBeNull();
  });

  it("keeps purple pitch-4 cards", () => {
    const row = toCardRow({ ...base, name: "Soul of Existence", pitch: "4", color: "Purple" });
    expect(row.pitch).toBe(4);
    expect(row.color).toBe("Purple");
  });

  it("rejects malformed entries instead of importing garbage", () => {
    expect(() => toCardRow({ ...base, pitch: "5" })).toThrow(/pitch/);
    expect(() => toCardRow({ ...base, name: " " })).toThrow(/name/);
  });
});

describe("tokens", () => {
  // Players borrow tokens too, so they're imported like any other card.
  it("maps tokens like any other card", () => {
    const row = toCardRow({ ...base, name: "Quicken", pitch: "", color: "", types: ["Generic", "Token", "Aura"] });
    expect(row.types).toContain("Token");
    expect(row.pitch).toBeNull();
  });
});

describe("groupCards", () => {
  const row = (id: string, name: string, pitch: number | null): CardRow => ({
    id,
    name,
    pitch,
    color: pitch === 1 ? "Red" : pitch === 2 ? "Yellow" : pitch === 3 ? "Blue" : null,
    types: ["Generic", "Action"],
    image_url: null,
    set_ids: [],
  });

  it("collapses pitch variants into one entry per name, keeping rank order", () => {
    const groups = groupCards([
      row("s1", "Snatch", 1),
      row("s2", "Snatch", 2),
      row("s3", "Snatch", 3),
      row("g3", "Snag", 3),
      row("t", "Fyendal's Spring Tunic", null),
    ]);
    expect(groups.map((g) => [g.name, g.variants.map((v) => v.id)])).toEqual([
      ["Snatch", ["s1", "s2", "s3"]],
      ["Snag", ["g3"]],
      ["Fyendal's Spring Tunic", ["t"]],
    ]);
  });

  it("sorts variants by pitch even if rows arrive out of order", () => {
    const [g] = groupCards([row("b", "Snatch", 3), row("r", "Snatch", 1), row("y", "Snatch", 2)]);
    expect(g.variants.map((v) => v.color)).toEqual(["Red", "Yellow", "Blue"]);
  });

  it("returns nothing for no rows", () => {
    expect(groupCards([])).toEqual([]);
  });
});

describe("latestExpansion", () => {
  // n distinct cards printed in each listed set
  const cardsIn = (setIds: string[], n: number, prefix: string): FabCubeCard[] =>
    Array.from({ length: n }, (_, i) => ({
      ...base,
      unique_id: `${prefix}${i}`,
      printings: setIds.map((set_id) => ({ set_id, image_url: null })),
    }));
  const set = (id: string, ...dates: (string | null)[]): FabCubeSet => ({
    id,
    name: `Set ${id}`,
    printings: dates.map((initial_release_date) => ({ initial_release_date })),
  });

  it("picks the newest set that is big enough to be an expansion", () => {
    const cards = [...cardsIn(["OLD"], 250, "o"), ...cardsIn(["NEW"], 200, "n"), ...cardsIn(["DECK"], 40, "d")];
    const sets = [
      set("OLD", "2025-06-06T00:00:00.000Z"),
      set("NEW", "2026-06-05T00:00:00.000Z"),
      set("DECK", "2026-08-07T00:00:00.000Z"), // newer, but only a 40-card deck
    ];
    expect(latestExpansion(cards, sets)).toEqual({ id: "NEW", name: "Set NEW", releasedOn: "2026-06-05" });
  });

  it("counts reprints toward every set they appear in", () => {
    const cards = cardsIn(["A", "B"], EXPANSION_MIN_CARDS, "r");
    const sets = [set("A", "2024-01-01T00:00:00.000Z"), set("B", "2025-01-01T00:00:00.000Z")];
    expect(latestExpansion(cards, sets)?.id).toBe("B");
  });

  it("uses a set's first edition date and skips sets without dates", () => {
    const cards = [...cardsIn(["A"], 200, "a"), ...cardsIn(["B"], 200, "b"), ...cardsIn(["C"], 200, "c")];
    const sets = [
      set("A", "2026-01-01T00:00:00.000Z", "2023-01-01T00:00:00.000Z"), // reprint edition later; first release 2023
      set("B", "2024-01-01T00:00:00.000Z"),
      set("C", null),
    ];
    expect(latestExpansion(cards, sets)?.id).toBe("B");
  });

  it("returns null when nothing qualifies", () => {
    expect(latestExpansion(cardsIn(["X"], 10, "x"), [set("X", "2026-01-01T00:00:00.000Z")])).toBeNull();
  });
});

describe("set codes", () => {
  const set = (id: string, name: string, ...dates: (string | null)[]): FabCubeSet => ({
    id,
    name,
    printings: dates.map((d) => ({ initial_release_date: d && `${d}T00:00:00.000Z` })),
  });
  const sets = setInfo([
    set("WTR", "Welcome to Rathe", "2019-10-11"),
    set("1HP", "History Pack 1", "2023-02-24", "2021-07-09"), // reprint edition listed first
    set("PEN", "Compendium of Rathe", "2026-02-13"),
    set("ASB", "Armory Deck - Boltyn", "2025-03-14"),
    set("AHA", "Armory Deck Origins - Hala", "2026-04-17"),
    set("SFA", "Silver Age Chapter 2 - Fai", "2026-02-13"),
    set("SBA", "Silver Age Chapter 3 - Briar", null),
    set("PROMO", "No date", null),
  ]);
  const ids = (...codes: string[]) => ({ printings: codes.map((set_id) => ({ set_id, image_url: null })) });

  it("uses each set's earliest release date and flags Armory / Silver Age decks", () => {
    expect(sets.get("1HP")).toEqual({ releasedOn: "2021-07-09", isDeck: false });
    expect(sets.get("AHA")?.isDeck).toBe(true);
    expect(sets.get("SFA")?.isDeck).toBe(true);
    expect(sets.get("PEN")?.isDeck).toBe(false);
    expect(sets.get("PROMO")?.releasedOn).toBeNull();
  });

  it("lists regular sets newest first (undated after), with all Armory/Silver Age decks at the back", () => {
    expect(cardSetIds(ids("ASB", "SBA", "WTR", "PROMO", "SFA", "PEN", "WTR", "1HP", "AHA"), sets)).toEqual([
      "PEN",
      "1HP",
      "WTR",
      "PROMO",
      "AHA",
      "SFA",
      "ASB",
      "SBA", // undated deck: still a deck, so after every regular set
    ]);
  });

  it("ends up on the card row", () => {
    expect(toCardRow(base, sets).set_ids).toEqual(["1HP", "WTR"]);
  });

  it("formats compactly, truncating long lists", () => {
    expect(formatSetIds(["PEN", "1HP", "WTR"])).toBe("PEN · 1HP · WTR");
    expect(formatSetIds(["A", "B", "C", "D", "E", "F", "G"])).toBe("A · B · C · D · E +2 more");
    expect(formatSetIds([])).toBe("");
  });
});

describe("formatReleaseMonth", () => {
  it("formats a date as month and year, without time zone drift", () => {
    expect(formatReleaseMonth("2026-06-05")).toBe("June 2026");
    expect(formatReleaseMonth("2026-01-01")).toBe("January 2026");
  });
});

describe("cardLabel", () => {
  it("adds the pitch color when there is one", () => {
    expect(cardLabel({ name: "Snatch", color: "Blue" })).toBe("Snatch (Blue)");
    expect(cardLabel({ name: "Dorinthea Ironsong", color: null })).toBe("Dorinthea Ironsong");
  });
});
