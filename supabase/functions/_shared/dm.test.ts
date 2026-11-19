import { describe, expect, it } from "vitest";
import { batchDms, dmLine, type DmBatch, type DmItem } from "./dm.ts";

const APP = "https://armorypal.test";
const THURSDAY = { id: "7afd6814-aa2c-490d-a17c-3dac4b852563", label: "Thursday Armory", starts_at: "2026-11-19T23:00:00Z", store: "Uncommons" };
const SATURDAY = { id: "8bfd6814-aa2c-490d-a17c-3dac4b852563", label: "Saturday Armory", starts_at: "2026-11-21T18:00:00Z", store: "Gamestoria" };

let nextId = 1;
const item = (kind: string, payload: DmItem["payload"], event = THURSDAY): DmItem => ({
  id: nextId++,
  kind,
  payload,
  created_at: "2026-11-18T12:00:00Z",
  event,
});
const batch = (...items: DmItem[]): DmBatch => ({ user_id: "u", discord_id: "1", items });

describe("dmLine", () => {
  const line = (kind: string, p: DmItem["payload"]) =>
    dmLine({ kind, actor: p.actor ?? "Someone", reason: p.reason, card: p.card ?? "a card", items: p.items ?? 1, copies: p.copies ?? 1 });

  it("words new requests like the app", () => {
    expect(line("new_requests", { actor: "Alice", card: "Snatch (Red)", items: 1, copies: 3 })).toBe("Alice needs 3× Snatch \\(Red\\).");
    expect(line("new_requests", { actor: "Alice", card: "Snatch (Red)", items: 3, copies: 5 })).toBe("Alice needs 5 cards: Snatch \\(Red\\) and 2 more.");
  });

  it("words cards needed again by reason", () => {
    expect(line("card_needed_again", { actor: "Bob", card: "Sink Below", copies: 1, reason: "unpledged" })).toBe(
      "Bob can't bring 1× Sink Below anymore. It's needed again.",
    );
    expect(line("card_needed_again", { actor: "Bob", card: "Sink Below", items: 2, copies: 3, reason: "left_event" })).toBe(
      "Bob can't make it anymore, so 3 cards are needed again: Sink Below and 1 more.",
    );
    expect(line("card_needed_again", { actor: "Bob", card: "Sink Below", copies: 2, reason: "removed" })).toBe(
      "Bob was removed from the event, so 2× Sink Below is needed again.",
    );
  });
});

describe("batchDms", () => {
  it("sends one message per player, grouped by event, with links to each Requests tab", () => {
    const msg = batchDms(
      batch(
        item("new_requests", { actor: "Alice", card: "Snatch (Red)", items: 1, copies: 2 }),
        item("card_needed_again", { actor: "Bob", card: "Sink Below (Blue)", items: 1, copies: 1, reason: "unpledged" }),
        item("new_requests", { actor: "Carol", card: "Nimblism (Red)", items: 1, copies: 1 }, SATURDAY),
      ),
      APP,
    );
    expect(msg.content).toBe(
      [
        "**Thursday Armory** at Uncommons · <t:1795129200:f>\n• Alice needs 2× Snatch \\(Red\\).\n• Bob can't bring 1× Sink Below \\(Blue\\) anymore. It's needed again.",
        "**Saturday Armory** at Gamestoria · <t:1795284000:f>\n• Carol needs 1× Nimblism \\(Red\\).",
        "-# You turned on Discord DMs in ArmoryPal. Turn them off in Notification settings.",
      ].join("\n\n"),
    );
    expect(msg.components?.[0].components.map((b) => [b.label, b.url])).toEqual([
      ["Requests · Thursday Armory", `${APP}/events/${THURSDAY.id}?tab=requests`],
      ["Requests · Saturday Armory", `${APP}/events/${SATURDAY.id}?tab=requests`],
      ["Notification settings", `${APP}/settings/notifications`],
    ]);
    expect(msg.allowed_mentions).toEqual({ parse: [] });
  });

  it("merges several adds by the same player into one line", () => {
    const msg = batchDms(
      batch(
        item("new_requests", { actor: "Alice", card: "Snatch (Red)", items: 1, copies: 2 }),
        item("new_requests", { actor: "Alice", card: "Sink Below (Blue)", items: 2, copies: 3 }),
      ),
      APP,
    );
    expect(msg.content).toContain("• Alice needs 5 cards: Snatch \\(Red\\) and 2 more.");
    expect(msg.components?.[0].components[0].label).toBe("See the requests");
  });

  it("escapes player text and never mentions", () => {
    const msg = batchDms(batch(item("new_requests", { actor: "@everyone **x**", card: "[a](https://evil)", copies: 1 })), APP);
    expect(msg.content).not.toContain("@everyone");
    expect(msg.content).toContain("\\*\\*x\\*\\*");
    expect(msg.content).toContain("\\[a\\]\\(https://evil\\)");
  });

  it("stays within 2000 characters and 5 buttons for very busy batches", () => {
    const events = Array.from({ length: 30 }, (_, i) => ({ ...THURSDAY, id: `${i}`.padStart(8, "0") + THURSDAY.id.slice(8), label: `Armory number ${i} with a long name` }));
    const items = events.flatMap((ev) =>
      Array.from({ length: 5 }, (_, j) => item("new_requests", { actor: `Player ${j} with a long display name`, card: "A card with a very long name (Red)", items: 4, copies: 9 }, ev)),
    );
    const msg = batchDms(batch(...items), APP);
    expect(msg.content!.length).toBeLessThanOrEqual(2000);
    expect(msg.content).toMatch(/…and updates for \d+ more events in ArmoryPal\./);
    expect(msg.components?.[0].components.length).toBeLessThanOrEqual(5);
  });
});
