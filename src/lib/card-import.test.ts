import { describe, expect, it } from "vitest";
import {
  buildImportPreview,
  chooseVariant,
  importCopies,
  importItemLabel,
  parseCardList,
  type Resolution,
} from "./card-import";
import type { CardRow } from "./cards";

const card = (id: string, name: string, pitch: number | null): CardRow => ({
  id,
  name,
  pitch,
  color: pitch === 1 ? "Red" : pitch === 2 ? "Yellow" : pitch === 3 ? "Blue" : null,
  types: [],
  image_url: null,
  set_ids: [],
});

describe("parseCardList", () => {
  it("parses the common formats", () => {
    const { lines, skipped } = parseCardList(
      ["1 Sledge of Anvilheim", "3x Oaken Old", "Imposing Visage x2", "Heart of Ice", "  2 Boulder Drop  "].join("\n"),
    );
    expect(skipped).toEqual([]);
    expect(lines.map((l) => [l.quantity, l.name, l.color])).toEqual([
      [1, "Sledge of Anvilheim", null],
      [3, "Oaken Old", null],
      [2, "Imposing Visage", null],
      [1, "Heart of Ice", null],
      [2, "Boulder Drop", null],
    ]);
    expect(lines.map((l) => l.lineNo)).toEqual([1, 2, 3, 4, 5]);
  });

  it("reads an optional color", () => {
    const { lines } = parseCardList("2 Snatch (Blue)\nSnatch [y]\n1 Snatch - red\nSnatch (3)");
    expect(lines.map((l) => [l.name, l.color])).toEqual([
      ["Snatch", "Blue"],
      ["Snatch", "Yellow"],
      ["Snatch", "Red"],
      ["Snatch", "Blue"],
    ]);
  });

  it("doesn't mistake parts of a name for a color", () => {
    const { lines } = parseCardList("1 Crown of Frozen Thoughts\n1 Red in the Ledger\n1 Fyendal's Spring Tunic");
    expect(lines.map((l) => [l.name, l.color])).toEqual([
      ["Crown of Frozen Thoughts", null],
      ["Red in the Ledger", null],
      ["Fyendal's Spring Tunic", null],
    ]);
  });

  it("ignores blanks, comments and bullets; skips lines without a usable quantity", () => {
    const { lines, skipped } = parseCardList("# deck\n\n// sideboard\n- 2 Snatch\n0 Snatch\n3");
    expect(lines.map((l) => [l.quantity, l.name])).toEqual([[2, "Snatch"]]);
    expect(skipped.map((s) => [s.lineNo, s.reason])).toEqual([
      [5, "Quantity must be at least 1"],
      [6, "No card name"],
    ]);
  });
});

describe("chooseVariant", () => {
  const boulder = [card("b3", "Boulder Drop", 3), card("b1", "Boulder Drop", 1), card("b2", "Boulder Drop", 2)];

  it("defaults multi-color cards to Red", () => {
    expect(chooseVariant(boulder, null)).toEqual({ card: boulder[1], defaulted: true });
  });

  it("uses the requested color, or explains when it doesn't exist", () => {
    expect(chooseVariant(boulder, "Blue")).toEqual({ card: boulder[0], defaulted: false });
    expect(chooseVariant([card("t", "Tunic", null)], "Blue")).toEqual({ reason: "No Blue version" });
  });

  it("takes the only version without marking it defaulted", () => {
    expect(chooseVariant([card("t", "Tunic", null)], null)).toEqual({ card: card("t", "Tunic", null), defaulted: false });
  });

  it("falls back to the lowest pitch when there's no Red", () => {
    const yb = [card("y", "X", 2), card("b", "X", 3)];
    expect(chooseVariant(yb, null)).toEqual({ card: yb[0], defaulted: true });
  });

  it("reports cards that weren't found", () => {
    expect(chooseVariant([], null)).toEqual({ reason: "Not found" });
  });
});

describe("buildImportPreview", () => {
  const variants = new Map<string, CardRow[]>([
    ["Boulder Drop", [card("b1", "Boulder Drop", 1), card("b2", "Boulder Drop", 2), card("b3", "Boulder Drop", 3)]],
    ["Crown of Frozen Thoughts", [card("cf", "Crown of Frozen Thoughts", null)]],
    ["Titan's Fist", [card("tf", "Titan's Fist", null)]],
  ]);
  const res = (name: string | null, match: Resolution["match"] = "exact"): Resolution => ({ name, match: name ? match : null });

  it("builds items, defaults to Red, flags typos, and lists what wasn't imported", () => {
    const { lines } = parseCardList("2 Boulder Drop\n1 Crown of Frozen Toughts\n1 Ice Age Oak\n1 Titans Fist (Blue)");
    const { items, skipped } = buildImportPreview(
      lines,
      [res("Boulder Drop"), res("Crown of Frozen Thoughts", "typo"), res(null), res("Titan's Fist")],
      variants,
    );
    expect(items.map(importItemLabel)).toEqual(["2× Boulder Drop (Red)", "1× Crown of Frozen Thoughts"]);
    expect(items[0]).toMatchObject({ defaultedToRed: true, typedAs: [] });
    expect(items[0].variants.map((v) => v.color)).toEqual(["Red", "Yellow", "Blue"]);
    expect(items[1]).toMatchObject({ defaultedToRed: false, typedAs: ["Crown of Frozen Toughts"] });
    expect(skipped).toEqual([
      { lineNo: 3, raw: "1 Ice Age Oak", reason: "Not found" },
      { lineNo: 4, raw: "1 Titans Fist (Blue)", reason: "No Blue version" },
    ]);
    expect(importCopies(items)).toBe(3);
  });

  it("sums repeated lines for the same card and caps at 20", () => {
    const { lines } = parseCardList("15 Boulder Drop\n10 Boulder Drop (Red)\n1 Boulder Drop (Blue)");
    const { items } = buildImportPreview(lines, [res("Boulder Drop"), res("Boulder Drop"), res("Boulder Drop")], variants);
    expect(items.map((i) => [importItemLabel(i), i.capped])).toEqual([
      ["20× Boulder Drop (Red)", true],
      ["1× Boulder Drop (Blue)", false],
    ]);
  });
});
