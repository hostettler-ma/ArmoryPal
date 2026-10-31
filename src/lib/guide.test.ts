import { describe, expect, it } from "vitest";
import { GUIDE_STEPS } from "./guide";

describe("GUIDE_STEPS", () => {
  it("has a title and body for every step", () => {
    expect(GUIDE_STEPS.length).toBeGreaterThan(1);
    for (const step of GUIDE_STEPS) {
      expect(step.title.trim()).not.toBe("");
      expect(step.body.trim()).not.toBe("");
    }
  });

  it("only links within the app", () => {
    for (const { link } of GUIDE_STEPS) {
      if (link) expect(link.href).toMatch(/^\/(?!\/)/);
    }
  });
});
