import { describe, expect, it } from "vitest";
import { formatNotification, formatRelative, NOTIFICATION_KINDS } from "./notifications";

const base = { card: "Snatch (Red)", quantity: 2, actor: "Tomas" };

describe("formatNotification", () => {
  it("explains a released pledge, by reason", () => {
    expect(formatNotification("pledge_released", { ...base, reason: "left_event" })).toBe(
      "Tomas can't make it anymore, so 2× Snatch (Red) is needed again.",
    );
    expect(formatNotification("pledge_released", { ...base, reason: "unpledged" })).toBe(
      "Tomas can no longer bring 2× Snatch (Red). It's needed again.",
    );
  });

  it("explains a cancelled request, by reason", () => {
    expect(formatNotification("request_cancelled", { ...base, actor: "Rhea", reason: "cancelled" })).toBe(
      "Rhea no longer needs Snatch (Red). You don't need to bring 2× Snatch (Red).",
    );
    expect(formatNotification("request_cancelled", { ...base, actor: "Rhea", reason: "left_event" })).toMatch(
      /^Rhea isn't going anymore/,
    );
  });

  it("summarizes new requests in one line", () => {
    expect(formatNotification("new_requests", { actor: "Rhea", card: "Snatch (Red)", items: 1, copies: 3 })).toBe(
      "Rhea needs 3× Snatch (Red).",
    );
    expect(formatNotification("new_requests", { actor: "Rhea", card: "Snatch (Red)", items: 2, copies: 4 })).toBe(
      "Rhea needs 4 cards: Snatch (Red) and 1 more.",
    );
  });

  it("tells followers which cards are needed again, by reason", () => {
    const one = { actor: "Tomas", card: "Snatch (Red)", items: 1, copies: 2 };
    expect(formatNotification("card_needed_again", { ...one, reason: "unpledged" })).toBe(
      "2× Snatch (Red) is needed again: Tomas can't bring it anymore.",
    );
    expect(formatNotification("card_needed_again", { ...one, reason: "left_event" })).toBe(
      "Tomas can't make it anymore, so 2× Snatch (Red) is needed again.",
    );
    expect(formatNotification("card_needed_again", { ...one, items: 2, copies: 3, reason: "removed" })).toBe(
      "Tomas was removed from the event, so 3 cards are needed again: Snatch (Red) and 1 more.",
    );
  });

  it("explains admin removals", () => {
    expect(formatNotification("pledge_released", { ...base, reason: "removed" })).toMatch(/was removed from the event/);
    expect(formatNotification("request_cancelled", { ...base, actor: "Rhea", reason: "removed" })).toMatch(
      /^Rhea was removed from the event, so their request/,
    );
    expect(formatNotification("removed_from_event", { note: "No-show last week" })).toBe(
      "An admin removed you from this event. Reason: No-show last week",
    );
    expect(formatNotification("removed_from_event", {})).toBe("An admin removed you from this event.");
  });

  it("celebrates fully covered requests", () => {
    expect(formatNotification("requests_filled", { requests: 3, copies: 5 })).toBe(
      "All 3 of your requests are covered. Someone is bringing every card you asked for.",
    );
    expect(formatNotification("requests_filled", { requests: 1, copies: 2 })).toMatch(/^Your request is covered/);
  });

  it("has settings metadata for every kind it can format", () => {
    for (const { kind } of NOTIFICATION_KINDS) {
      expect(formatNotification(kind, base)).not.toBe("Something changed in one of your events.");
    }
  });

  it("degrades gracefully on missing fields or unknown kinds", () => {
    expect(formatNotification("pledge_released", {})).toBe("Someone can no longer bring 1× a card. It's needed again.");
    expect(formatNotification("mystery", base)).toBe("Something changed in one of your events.");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  it.each([
    ["2026-11-03T11:59:30Z", "just now"],
    ["2026-11-03T11:55:00Z", "5 min ago"],
    ["2026-11-03T09:00:00Z", "3 h ago"],
    ["2026-10-30T09:00:00Z", "Oct 30"],
  ])("%s → %s", (iso, expected) => expect(formatRelative(iso, now)).toBe(expected));
});
