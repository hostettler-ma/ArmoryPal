import { describe, expect, it } from "vitest";
import { currentEventFor, eventPhase, formatEventWhen } from "./events";

const TUE_1830 = { weekday: 2, start_time: "18:30:00" };
const at = (iso: string) => new Date(iso);

describe("currentEventFor", () => {
  it("picks the next occurrence later in the week", () => {
    // Mon 2026-11-02 10:00 in Chicago (UTC-6)
    const occ = currentEventFor(TUE_1830, "America/Chicago", at("2026-11-02T16:00:00Z"));
    expect(occ.eventDate).toBe("2026-11-03");
    expect(occ.startsAt.toISOString()).toBe("2026-11-04T00:30:00.000Z");
    expect(occ.endsAt.toISOString()).toBe("2026-11-04T06:00:00.000Z");
  });

  it("keeps today's event current until the local day ends, even after it started", () => {
    // Tue 2026-11-03 23:59 Chicago = Wed 05:59Z
    expect(currentEventFor(TUE_1830, "America/Chicago", at("2026-11-04T05:59:00Z")).eventDate).toBe("2026-11-03");
    // Wed 00:00 Chicago: rolls over to next week
    expect(currentEventFor(TUE_1830, "America/Chicago", at("2026-11-04T06:00:00Z")).eventDate).toBe("2026-11-10");
  });

  it("uses the store's local day, not UTC's", () => {
    // Tue 2026-11-03 20:00Z is already Wed 07:00 in Melbourne (UTC+11): next Tuesday
    expect(currentEventFor(TUE_1830, "Australia/Melbourne", at("2026-11-03T20:00:00Z")).eventDate).toBe("2026-11-10");
    // ...but still Tue 12:00 in Los Angeles: today
    expect(currentEventFor(TUE_1830, "America/Los_Angeles", at("2026-11-03T20:00:00Z")).eventDate).toBe("2026-11-03");
  });

  it("applies the new UTC offset after a DST change (US fall back, Nov 1 2026)", () => {
    // Before: Tue Oct 27 18:30 CDT = 23:30Z. After: Tue Nov 3 18:30 CST = 00:30Z next day.
    expect(currentEventFor(TUE_1830, "America/Chicago", at("2026-10-26T12:00:00Z")).startsAt.toISOString()).toBe(
      "2026-10-27T23:30:00.000Z",
    );
    expect(currentEventFor(TUE_1830, "America/Chicago", at("2026-10-28T12:00:00Z")).startsAt.toISOString()).toBe(
      "2026-11-04T00:30:00.000Z",
    );
  });

  it("handles an event week that spans the DST change itself (EU, Mar 29 2026)", () => {
    // Sat Mar 28 London (GMT) asking for Sunday 13:00 → Sun Mar 29 13:00 BST = 12:00Z
    const occ = currentEventFor({ weekday: 0, start_time: "13:00" }, "Europe/London", at("2026-03-28T12:00:00Z"));
    expect(occ.eventDate).toBe("2026-03-29");
    expect(occ.startsAt.toISOString()).toBe("2026-03-29T12:00:00.000Z");
    expect(occ.endsAt.toISOString()).toBe("2026-03-29T23:00:00.000Z"); // midnight BST
  });

  it("crosses month and year boundaries", () => {
    // Wed 2026-12-30 asking for Saturday → Sat 2027-01-02
    expect(currentEventFor({ weekday: 6, start_time: "13:00" }, "Europe/London", at("2026-12-30T12:00:00Z")).eventDate).toBe(
      "2027-01-02",
    );
  });
});

describe("eventPhase", () => {
  const ev = { starts_at: "2026-11-04T00:30:00Z", ends_at: "2026-11-04T06:00:00Z" };
  it.each([
    ["2026-11-03T12:00:00Z", "upcoming"],
    ["2026-11-04T00:30:00Z", "live"],
    ["2026-11-04T05:59:59Z", "live"],
    ["2026-11-04T06:00:00Z", "ended"],
  ])("at %s → %s", (now, phase) => expect(eventPhase(ev, at(now))).toBe(phase));
});

describe("formatEventWhen", () => {
  const start = "2026-11-04T00:30:00Z"; // Tue Nov 3, 6:30 PM in Chicago

  it("says Today / Tomorrow relative to the store's local date", () => {
    expect(formatEventWhen(start, "America/Chicago", at("2026-11-03T15:00:00Z"))).toBe("Today · 6:30 PM");
    expect(formatEventWhen(start, "America/Chicago", at("2026-11-02T15:00:00Z"))).toBe("Tomorrow · 6:30 PM");
  });

  it("falls back to a short date", () => {
    expect(formatEventWhen(start, "America/Chicago", at("2026-10-30T15:00:00Z"))).toBe("Tue, Nov 3 · 6:30 PM");
  });
});
