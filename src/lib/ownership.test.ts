import { describe, expect, it } from "vitest";
import { MAX_OWNERSHIP_MESSAGE, ownershipState, parseOwnershipMessage } from "./ownership";

describe("parseOwnershipMessage", () => {
  it("trims and allows empty", () => {
    expect(parseOwnershipMessage("  I run Fridays  ")).toEqual({ ok: true, value: "I run Fridays" });
    expect(parseOwnershipMessage(undefined)).toEqual({ ok: true, value: "" });
  });

  it("rejects long messages", () => {
    expect(parseOwnershipMessage("x".repeat(MAX_OWNERSHIP_MESSAGE)).ok).toBe(true);
    expect(parseOwnershipMessage("x".repeat(MAX_OWNERSHIP_MESSAGE + 1)).ok).toBe(false);
  });
});

describe("ownershipState", () => {
  it("prefers owner over pending", () => {
    expect(ownershipState(true, true)).toBe("owner");
    expect(ownershipState(false, true)).toBe("pending");
    expect(ownershipState(false, false)).toBe("none");
  });
});
