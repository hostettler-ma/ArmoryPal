import { describe, expect, it } from "vitest";
import { ruleMessage } from "../../../src/lib/rules.ts";
import { COMMANDS } from "./commands.ts";
import { buttonId, parseButtonId } from "./custom-id.ts";
import { BOT_MESSAGES, botMessage, FALLBACK_MESSAGE } from "./messages.ts";
import { escapeMarkdown, parsePostTime, pitchEmoji, truncate } from "./text.ts";

const EVENT = "7afd6814-aa2c-490d-a17c-3dac4b852563";

describe("button ids", () => {
  it("round-trip and stay under Discord's 100 characters", () => {
    for (const action of ["going", "leave", "leave-cancel", "leave-keep", "requests"] as const) {
      const id = buttonId(action, EVENT);
      expect(id.length).toBeLessThanOrEqual(100);
      expect(parseButtonId(id)).toEqual({ action, eventId: EVENT });
    }
  });

  it("reject crafted ids", () => {
    for (const bad of [undefined, "", "ap:going", `ap:delete:${EVENT}`, `ap:going:${EVENT}x`, "ap:going:not-a-uuid-at-all-not-a-uuid-at-all-xx", `x:going:${EVENT}`]) {
      expect(parseButtonId(bad)).toBeNull();
    }
  });
});

describe("bot messages", () => {
  it("cover only codes the app knows too (ruleMessage)", () => {
    for (const code of Object.keys(BOT_MESSAGES)) expect(ruleMessage(code), code).not.toBe("Something went wrong. Try again.");
  });

  it("fall back for unknown codes", () => {
    expect(botMessage("nope")).toBe(FALLBACK_MESSAGE);
    expect(botMessage(null)).toBe(FALLBACK_MESSAGE);
  });
});

describe("text helpers", () => {
  it("escape markdown, mentions and timestamps in player text", () => {
    expect(escapeMarkdown("**Bold** _x_ [link](https://evil)")).toBe("\\*\\*Bold\\*\\* \\_x\\_ \\[link\\]\\(https://evil\\)");
    const zw = String.fromCharCode(0x200b);
    expect(escapeMarkdown("@everyone <@123> <t:1:R>")).toBe(`@${zw}everyone <${zw}@${zw}123\\> <${zw}t:1:R\\>`);
    expect(escapeMarkdown("two\nlines")).toBe("two lines");
  });

  it("map pitch to dots", () => {
    expect([1, 2, 3, 4, null].map(pitchEmoji)).toEqual(["🔴", "🟡", "🔵", "🟣", "⚪"]);
  });

  it("parse 24-hour post times", () => {
    expect(parsePostTime("9:05")).toBe("09:05");
    expect(parsePostTime("18.30")).toBe("18:30");
    expect(parsePostTime("24:00")).toBeNull();
    expect(parsePostTime("7pm")).toBeNull();
  });

  it("truncate with an ellipsis", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });
});

describe("command definitions", () => {
  it("stay within Discord's limits", () => {
    const walk = (o: { name: string; description: string; options?: readonly unknown[] }) => {
      expect(o.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(o.description.length).toBeGreaterThan(0);
      expect(o.description.length).toBeLessThanOrEqual(100);
      expect((o.options ?? []).length).toBeLessThanOrEqual(25);
      for (const child of o.options ?? []) walk(child as typeof o);
    };
    for (const c of COMMANDS) walk(c);
  });

  it("are for server managers by default, in servers only", () => {
    expect(COMMANDS[0].default_member_permissions).toBe("32");
    expect(COMMANDS[0].contexts).toEqual([0]);
  });
});
