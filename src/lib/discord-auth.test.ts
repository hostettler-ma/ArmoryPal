import { describe, expect, it } from "vitest";
import { canonicalDiscordAuthorizeUrl, isDiscordAuthorizeUrl, isSupabaseDiscordAuthorizeUrl } from "./discord-auth";

const SUPABASE = "https://hlfjqfwiotpvbjrslrnn.supabase.co";

describe("isSupabaseDiscordAuthorizeUrl", () => {
  it.each([
    [`${SUPABASE}/auth/v1/authorize?provider=discord&code_challenge=x`, SUPABASE, true],
    ["http://127.0.0.1:54321/auth/v1/authorize?provider=discord", "http://127.0.0.1:54321", true],
    [`${SUPABASE}/auth/v1/authorize?provider=github`, SUPABASE, false],
    [`${SUPABASE}/auth/v1/token?provider=discord`, SUPABASE, false],
    ["https://evil.example/auth/v1/authorize?provider=discord", SUPABASE, false],
    [`https://hlfjqfwiotpvbjrslrnn.supabase.co.evil.example/auth/v1/authorize?provider=discord`, SUPABASE, false],
    ["http://169.254.169.254/latest/meta-data", SUPABASE, false],
    ["not a url", SUPABASE, false],
  ])("%s → %s", (url, base, expected) => {
    expect(isSupabaseDiscordAuthorizeUrl(url, base)).toBe(expected);
  });
});

describe("isDiscordAuthorizeUrl", () => {
  it.each([
    ["https://discord.com/oauth2/authorize?client_id=1&prompt=none", true],
    ["https://discord.com/api/oauth2/authorize?client_id=1", true],
    ["http://discord.com/oauth2/authorize", false],
    ["https://discord.com.evil.example/oauth2/authorize", false],
    ["https://evil.example/oauth2/authorize?discord.com", false],
    ["https://discord.com/login", false],
    ["javascript:alert(1)", false],
    ["", false],
  ])("%s → %s", (url, expected) => {
    expect(isDiscordAuthorizeUrl(url)).toBe(expected);
  });
});

describe("canonicalDiscordAuthorizeUrl", () => {
  it("drops /api and keeps the query", () => {
    expect(canonicalDiscordAuthorizeUrl("https://discord.com/api/oauth2/authorize?client_id=1&prompt=none&state=a.b")).toBe(
      "https://discord.com/oauth2/authorize?client_id=1&prompt=none&state=a.b",
    );
  });

  it("leaves the canonical path alone", () => {
    expect(canonicalDiscordAuthorizeUrl("https://discord.com/oauth2/authorize?client_id=1")).toBe(
      "https://discord.com/oauth2/authorize?client_id=1",
    );
  });
});
