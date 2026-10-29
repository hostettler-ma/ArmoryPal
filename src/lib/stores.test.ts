import { describe, expect, it } from "vitest";
import { formatLocation, formatSchedule, formatTime, parseScheduleInput, parseStoreInput } from "./stores";

describe("formatTime", () => {
  it.each([
    ["00:00:00", "12:00 AM"],
    ["09:05", "9:05 AM"],
    ["12:00:00", "12:00 PM"],
    ["18:30:00", "6:30 PM"],
    ["23:59", "11:59 PM"],
  ])("%s → %s", (input, expected) => expect(formatTime(input)).toBe(expected));
});

describe("formatSchedule / formatLocation", () => {
  it("formats a weekly slot", () => {
    expect(formatSchedule({ weekday: 2, start_time: "18:30:00" })).toBe("Tuesdays · 6:30 PM");
    expect(formatSchedule({ weekday: 0, start_time: "13:00:00" })).toBe("Sundays · 1:00 PM");
  });

  it("skips a missing region", () => {
    expect(formatLocation({ city: "Manchester", region: null, country: "UK" })).toBe("Manchester, UK");
    expect(formatLocation({ city: "Portland", region: "OR", country: "USA" })).toBe("Portland, OR, USA");
  });
});

describe("parseStoreInput", () => {
  const valid = { name: " Pitch  Perfect ", city: "Portland", region: "", country: "USA", address: "", timezone: "America/Los_Angeles" };

  it("normalizes whitespace and blanks optional fields", () => {
    expect(parseStoreInput(valid)).toEqual({
      ok: true,
      value: { name: "Pitch Perfect", city: "Portland", region: null, country: "USA", address: null, timezone: "America/Los_Angeles" },
    });
  });

  it("requires name, city, and country", () => {
    const r = parseStoreInput({ ...valid, name: "", city: " ", country: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["city", "country", "name"]);
  });

  it("rejects an unknown time zone", () => {
    const r = parseStoreInput({ ...valid, timezone: "Mars/Olympus_Mons" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.timezone).toBeDefined();
  });
});

describe("parseScheduleInput", () => {
  it("defaults the label to Armory", () => {
    expect(parseScheduleInput({ label: "", weekday: "2", start_time: "18:30" })).toEqual({
      ok: true,
      value: { label: "Armory", weekday: 2, start_time: "18:30" },
    });
  });

  it.each([["7"], ["-1"], [""], ["1.5"]])("rejects weekday %j", (weekday) => {
    expect(parseScheduleInput({ weekday, start_time: "18:30" }).ok).toBe(false);
  });

  it.each([["24:00"], ["6:30"], ["18:60"], ["evening"]])("rejects start time %j", (start_time) => {
    expect(parseScheduleInput({ weekday: "3", start_time }).ok).toBe(false);
  });
});
