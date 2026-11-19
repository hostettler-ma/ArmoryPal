import { describe, expect, it } from "vitest";
import { ARMORYBOT_PERMISSIONS, armoryBotInviteUrl } from "./armorybot";

describe("armoryBotInviteUrl", () => {
  it("builds a server install link with the bot's four permissions", () => {
    const url = new URL(armoryBotInviteUrl(" 1572679708716568000 ")!);
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "1572679708716568000",
      scope: "bot applications.commands",
      permissions: "84992",
      integration_type: "0",
    });
  });

  it("is null without a valid application ID", () => {
    expect(armoryBotInviteUrl(undefined)).toBeNull();
    expect(armoryBotInviteUrl("")).toBeNull();
    expect(armoryBotInviteUrl("your-app-id")).toBeNull();
    expect(armoryBotInviteUrl("123")).toBeNull();
  });

  it("matches the permissions in DEPLOY.md", () => {
    expect(ARMORYBOT_PERMISSIONS).toBe(84992);
  });
});
