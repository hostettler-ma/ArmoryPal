import { describe, expect, it } from "vitest";
import { connectedAccounts, hasDiscord, linkErrorMessage } from "./connected-accounts";

const discord = { identity_id: "d1", provider: "discord", identity_data: { full_name: "alice#0" } };
const email = { identity_id: "e1", provider: "email", identity_data: { email: "alice@example.com" } };
const google = { identity_id: "g1", provider: "google", identity_data: { name: "Alice G" } };

describe("connectedAccounts", () => {
  it("always offers Discord, and connecting it when missing", () => {
    expect(connectedAccounts([email])).toEqual([
      expect.objectContaining({ provider: "discord", connected: false, canConnect: true, canDisconnect: false }),
      expect.objectContaining({ provider: "email", connected: true, detail: "alice@example.com", canDisconnect: false }),
    ]);
  });

  it("can't disconnect Discord when it's the only way to sign in", () => {
    expect(connectedAccounts([discord])).toEqual([
      expect.objectContaining({ provider: "discord", connected: true, detail: "alice#0", canConnect: false, canDisconnect: false }),
    ]);
  });

  it("can disconnect Discord when another identity remains", () => {
    const rows = connectedAccounts([google, discord]);
    expect(rows.map((r) => r.provider)).toEqual(["discord", "google"]);
    expect(rows[0]).toMatchObject({ identityId: "d1", canDisconnect: true });
    expect(rows[1]).toMatchObject({ detail: "Alice G", canDisconnect: false, canConnect: false });
  });

  it("detects a Discord identity", () => {
    expect(hasDiscord([email, discord])).toBe(true);
    expect(hasDiscord([email])).toBe(false);
    expect(hasDiscord(undefined)).toBe(false);
  });
});

describe("linkErrorMessage", () => {
  it("explains a Discord account that already has its own ArmoryPal account", () => {
    expect(linkErrorMessage("identity_already_exists")).toMatch(/already has its own ArmoryPal account/);
  });

  it("falls back for unknown codes and stays quiet without one", () => {
    expect(linkErrorMessage("weird")).toBe("Couldn't connect your Discord. Try again.");
    expect(linkErrorMessage(null)).toBeNull();
  });
});
