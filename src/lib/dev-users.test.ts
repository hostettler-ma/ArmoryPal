import { describe, expect, it } from "vitest";
import { devLoginEnabled, isDevUser, isLocalSupabase } from "./dev-users";

describe("isLocalSupabase", () => {
  it.each([
    ["http://127.0.0.1:54321", true],
    ["http://localhost:54321", true],
    ["https://hlfjqfwiotpvbjrslrnn.supabase.co", false],
    ["https://localhost.evil.example", false],
    ["not a url", false],
    [undefined, false],
  ])("%s → %s", (url, expected) => {
    expect(isLocalSupabase(url)).toBe(expected);
  });
});

describe("devLoginEnabled", () => {
  it("needs both next dev and a local Supabase", () => {
    expect(devLoginEnabled("development", "http://127.0.0.1:54321")).toBe(true);
    expect(devLoginEnabled("production", "http://127.0.0.1:54321")).toBe(false);
    expect(devLoginEnabled("development", "https://hlfjqfwiotpvbjrslrnn.supabase.co")).toBe(false);
  });
});

describe("isDevUser", () => {
  it("only accepts the seeded test players", () => {
    expect(isDevUser("alice@dev.local")).toBe(true);
    expect(isDevUser("someone@example.com")).toBe(false);
  });
});
