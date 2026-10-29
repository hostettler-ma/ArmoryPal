import { describe, expect, it } from "vitest";
import { parseProfileInput } from "./profile";

describe("parseProfileInput", () => {
  it("trims and collapses whitespace in the display name", () => {
    expect(parseProfileInput({ displayName: "  Bravo   Main ", gemId: "" })).toEqual({
      ok: true,
      value: { displayName: "Bravo Main", gemId: null },
    });
  });

  it("requires a display name", () => {
    const result = parseProfileInput({ displayName: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.displayName).toBeDefined();
  });

  it("rejects names over 40 characters", () => {
    expect(parseProfileInput({ displayName: "x".repeat(41) }).ok).toBe(false);
    expect(parseProfileInput({ displayName: "x".repeat(40) }).ok).toBe(true);
  });

  it("accepts a numeric GEM ID, ignoring spaces", () => {
    expect(parseProfileInput({ displayName: "Kano", gemId: "1234 5678" })).toEqual({
      ok: true,
      value: { displayName: "Kano", gemId: "12345678" },
    });
  });

  it("rejects non-numeric GEM IDs", () => {
    const result = parseProfileInput({ displayName: "Kano", gemId: "GEM-12" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.gemId).toBeDefined();
  });
});
