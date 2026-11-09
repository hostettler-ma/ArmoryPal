import { describe, expect, it } from "vitest";
import { formatNotification, formatRelative, notificationHref, NOTIFICATION_KINDS } from "./notifications";

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

  it("announces polls and formats", () => {
    expect(formatNotification("format_poll_opened", { store: "Dragon's Den", label: "Armory" })).toBe(
      "Dragon's Den asks which format to run at Armory. Cast your vote!",
    );
    expect(formatNotification("format_confirmed", { store: "Dragon's Den", label: "Armory", format: "silver_age" })).toBe(
      "Armory at Dragon's Den will be Silver Age.",
    );
    expect(notificationHref("format_confirmed", "e1", {})).toBe("/events/e1");
  });

  it("tells owners who dropped out", () => {
    expect(formatNotification("attendee_left", { actor: "Bob", label: "Armory", when: "Wed, Nov 11 · 6:30 PM" })).toBe(
      "Bob can't come to Armory (Wed, Nov 11 · 6:30 PM) anymore.",
    );
    expect(notificationHref("attendee_left", "e1", {})).toBe("/manage/events/e1");
  });

  it("says when an event moved", () => {
    expect(
      formatNotification("event_moved", {
        label: "Armory",
        store: "Dragon's Den",
        from: "Wed, Nov 11 · 6:30 PM",
        to: "Thu, Nov 12 · 7:00 PM",
      }),
    ).toBe("Armory at Dragon's Den moved from Wed, Nov 11 · 6:30 PM to Thu, Nov 12 · 7:00 PM.");
    expect(formatNotification("event_moved", {})).toBe("The Armory moved to a new time.");
  });

  it("answers ownership requests", () => {
    expect(formatNotification("ownership_decided", { approved: true, store: "Dragon's Den" })).toBe(
      "You can now manage Dragon's Den in ArmoryPal.",
    );
    expect(formatNotification("ownership_decided", { approved: false, store: "Dragon's Den", note: "Ask the owner" })).toBe(
      "Your request to manage Dragon's Den wasn't approved. Reason: Ask the owner",
    );
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

describe("notificationHref", () => {
  it("links event notifications to the right tab", () => {
    expect(notificationHref("new_requests", "e1", {})).toBe("/events/e1?tab=requests");
    expect(notificationHref("pledge_released", "e1", {})).toBe("/events/e1?tab=checklist");
    expect(notificationHref("pledge_released", null, {})).toBe("/");
  });

  it("links ownership answers to the store", () => {
    expect(notificationHref("ownership_decided", null, { approved: true, store_id: "s1" })).toBe("/manage/stores/s1");
    expect(notificationHref("ownership_decided", null, { approved: false, store_id: "s1" })).toBe("/stores/s1");
  });
});
