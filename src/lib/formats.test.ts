import { describe, expect, it } from "vitest";
import { formatLabel, parsePollOptions, pollOpen, pollResults } from "./formats";

describe("pollResults", () => {
  const options = ["draft", "cc", "silver_age", "csp"];

  it("counts votes, finds the leader and my vote", () => {
    const r = pollResults(
      options,
      [
        { user_id: "a", format: "cc" },
        { user_id: "b", format: "cc" },
        { user_id: "me", format: "draft" },
      ],
      "me",
    );
    expect(r.total).toBe(3);
    expect(r.leaders).toEqual(["cc"]);
    expect(r.mine).toBe("draft");
    expect(r.options.map((o) => [o.code, o.votes])).toEqual([
      ["draft", 1],
      ["cc", 2],
      ["silver_age", 0],
      ["csp", 0],
    ]);
    expect(r.options[1].share).toBeCloseTo(2 / 3);
  });

  it("reports ties and empty polls", () => {
    const tie = pollResults(options, [
      { user_id: "a", format: "csp" },
      { user_id: "b", format: "draft" },
    ], "me");
    expect(tie.leaders).toEqual(["draft", "csp"]);
    expect(tie.mine).toBeNull();
    expect(pollResults(options, [], "me")).toMatchObject({ total: 0, leaders: [] });
  });

  it("ignores votes for options not in the poll", () => {
    const r = pollResults(["draft", "cc"], [{ user_id: "me", format: "csp" }], "me");
    expect(r.total).toBe(0);
    expect(r.mine).toBeNull();
  });
});

describe("parsePollOptions", () => {
  it("needs two distinct known formats, in display order", () => {
    expect(parsePollOptions(["csp", "draft", "draft", "nope"])).toEqual({ ok: true, value: ["draft", "csp"] });
    expect(parsePollOptions(["draft"]).ok).toBe(false);
  });
});

describe("pollOpen", () => {
  const now = new Date("2026-11-11T17:00:00Z");
  it("closes at confirm or start", () => {
    expect(pollOpen({ closed_at: null }, { starts_at: "2026-11-11T18:00:00Z" }, now)).toBe(true);
    expect(pollOpen({ closed_at: "2026-11-10T00:00:00Z" }, { starts_at: "2026-11-11T18:00:00Z" }, now)).toBe(false);
    expect(pollOpen({ closed_at: null }, { starts_at: "2026-11-11T16:00:00Z" }, now)).toBe(false);
  });

  it("labels formats", () => {
    expect(formatLabel("csp")).toBe("Crack, Shuffle, Play");
    expect(formatLabel("x")).toBe("Unknown format");
  });
});
