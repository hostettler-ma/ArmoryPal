import { describe, expect, it } from "vitest";
import {
  daysBetween,
  eventTimes,
  isGemUrl,
  parseEventLinks,
  ticketLink,
  toLocalInputs,
  validateMove,
  validateOneOff,
} from "./event-manage";

const NY = "America/New_York";

describe("parseEventLinks", () => {
  it("accepts GEM links, codes and ticket links", () => {
    expect(parseEventLinks({ gem: "https://gem.fabtcg.com/event/123/", ticket: "https://shop.example.com/armory" })).toEqual({
      ok: true,
      value: { gem_url: "https://gem.fabtcg.com/event/123/", gem_code: null, ticket_url: "https://shop.example.com/armory" },
    });
    expect(parseEventLinks({ gem: " #12345 ", ticket: "" })).toEqual({
      ok: true,
      value: { gem_url: null, gem_code: "12345", ticket_url: null },
    });
    expect(parseEventLinks({})).toEqual({ ok: true, value: { gem_url: null, gem_code: null, ticket_url: null } });
  });

  it("rejects unsafe or foreign links", () => {
    for (const gem of ["http://gem.fabtcg.com/x", "https://evil.com/gem.fabtcg.com", "https://fabtcg.com.evil.com/", "javascript:alert(1)"]) {
      expect(parseEventLinks({ gem }).ok, gem).toBe(false);
    }
    for (const ticket of ["javascript:alert(1)", "http://shop.example.com", "shop.example.com", `https://a.com/${"x".repeat(300)}`]) {
      expect(parseEventLinks({ ticket }).ok, ticket).toBe(false);
    }
    expect(isGemUrl("https://fabtcg.com/events")).toBe(true);
  });
});

describe("ticketLink", () => {
  it("prefers the event's link over the store default", () => {
    expect(ticketLink({ ticket_url: "https://a.com/e" }, { ticket_url: "https://a.com/s" })).toBe("https://a.com/e");
    expect(ticketLink({ ticket_url: null }, { ticket_url: "https://a.com/s" })).toBe("https://a.com/s");
    expect(ticketLink({ ticket_url: null }, { ticket_url: null })).toBeNull();
  });
});

describe("eventTimes", () => {
  it("resolves local wall time across DST", () => {
    // Nov 1 2026: US DST ends. 18:30 EST = 23:30Z.
    expect(eventTimes("2026-11-01", "18:30", NY)!.startsAt.toISOString()).toBe("2026-11-01T23:30:00.000Z");
    expect(eventTimes("2026-10-31", "18:30", NY)!.startsAt.toISOString()).toBe("2026-10-31T22:30:00.000Z");
    expect(eventTimes("2026-11-01", "18:30", NY)!.endsAt.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(eventTimes("nope", "18:30", NY)).toBeNull();
  });
});

describe("validateMove", () => {
  const now = new Date("2026-11-09T15:00:00Z"); // Mon Nov 9, 10:00 in New York
  const weekly = { slotDate: "2026-11-11" };

  it("allows moves within a week of the slot", () => {
    expect(validateMove(weekly, "2026-11-12", "19:00", NY, now).ok).toBe(true);
    expect(validateMove(weekly, "2026-11-09", "18:00", NY, now).ok).toBe(true);
    expect(validateMove(weekly, "2026-11-17", "18:00", NY, now).ok).toBe(true);
  });

  it("rejects the past and moves into another week", () => {
    expect(validateMove(weekly, "2026-11-09", "09:00", NY, now)).toEqual({ ok: false, reason: "move_in_past" });
    expect(validateMove(weekly, "2026-11-18", "18:00", NY, now)).toEqual({ ok: false, reason: "move_too_far" });
    expect(validateMove({ slotDate: "2026-11-18" }, "2026-11-11", "18:00", NY, now)).toEqual({
      ok: false,
      reason: "move_too_far",
    });
  });

  it("limits one-off events to 90 days ahead", () => {
    expect(validateMove({ slotDate: null }, "2027-02-07", "18:00", NY, now).ok).toBe(true);
    expect(validateMove({ slotDate: null }, "2027-02-08", "18:00", NY, now)).toEqual({ ok: false, reason: "too_far_ahead" });
  });
});

describe("validateOneOff", () => {
  const now = new Date("2026-11-09T23:00:00Z"); // 18:00 in New York

  it("allows today until the day ends", () => {
    expect(validateOneOff("Pre-release", "2026-11-09", "12:00", NY, now).ok).toBe(true);
    expect(validateOneOff("Pre-release", "2026-11-08", "18:00", NY, now)).toEqual({ ok: false, reason: "date_in_past" });
  });

  it("checks the label", () => {
    expect(validateOneOff("  ", "2026-11-10", "18:00", NY, now)).toEqual({ ok: false, reason: "invalid_label" });
    expect(validateOneOff("x".repeat(41), "2026-11-10", "18:00", NY, now)).toEqual({ ok: false, reason: "invalid_label" });
  });
});

describe("helpers", () => {
  it("counts days and formats inputs in the store's zone", () => {
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(toLocalInputs("2026-11-01T23:30:00Z", NY)).toEqual({ date: "2026-11-01", time: "18:30" });
  });
});
