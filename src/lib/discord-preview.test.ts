import { describe, expect, it } from "vitest";
import { discordInline, discordTimestamp, EXAMPLE_POST } from "./discord-preview";

const opts = { timeZone: "America/Chicago", now: new Date("2026-11-24T16:00:00Z") };
const unix = Date.parse("2026-11-27T00:30:00Z") / 1000; // Thu Nov 26, 6:30 PM in Chicago

describe("discordTimestamp", () => {
  it("formats Discord's timestamp styles in the reader's zone", () => {
    expect(discordTimestamp(unix, "t", opts)).toBe("6:30 PM");
    expect(discordTimestamp(unix, "D", opts)).toBe("November 26, 2026");
    expect(discordTimestamp(unix, "R", opts)).toBe("in 2 days");
    expect(discordTimestamp(unix, "f", opts)).toMatch(/^November 26, 2026.*6:30 PM$/);
  });
});

describe("discordInline", () => {
  it("parses bold, links, timestamps and escapes", () => {
    expect(discordInline(`**Moved** from <t:${unix}:t>. Snatch \\(Red\\) +2 more in [ArmoryPal](https://a.test/e)`, opts)).toEqual([
      { kind: "bold", text: "Moved" },
      { kind: "text", text: " from " },
      { kind: "time", text: "6:30 PM" },
      { kind: "text", text: ". Snatch (Red) +2 more in " },
      { kind: "link", text: "ArmoryPal", href: "https://a.test/e" },
    ]);
  });

  it("leaves plain text alone", () => {
    expect(discordInline("Nothing needed right now.", opts)).toEqual([{ kind: "text", text: "Nothing needed right now." }]);
  });
});

describe("EXAMPLE_POST", () => {
  it("is the bot's real rendering, with Going and Not going buttons", () => {
    const embed = EXAMPLE_POST.embeds![0];
    expect(embed.title).toBe("Thursday Armory");
    expect(embed.fields?.map((f) => f.name)).toContain("Going (6)");
    expect(EXAMPLE_POST.components?.flatMap((r) => r.components.map((b) => b.label))).toEqual(["Going", "Not going", "Open in ArmoryPal"]);
  });
});
