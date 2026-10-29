import { describe, expect, it } from "vitest";
import { copySummary, type PreviousRequest } from "./rollover";

const req = (id: string, quantity: number, pledged: number[] = [], status = "active"): PreviousRequest => ({
  id,
  quantity,
  status,
  pledges: pledged.map((quantity) => ({ quantity })),
});

describe("copySummary", () => {
  it("counts only what's still needed", () => {
    expect(
      copySummary(
        [
          req("partial", 3, [1]), // 2 still needed
          req("covered", 1, [1]), // nothing needed
          req("open", 2), // 2 still needed
          req("cancelled", 4, [], "cancelled"),
        ],
        new Set(),
      ),
    ).toEqual({ requests: 2, copies: 4 });
  });

  it("skips requests already copied into this week", () => {
    expect(copySummary([req("a", 2), req("b", 1)], new Set(["a"]))).toEqual({ requests: 1, copies: 1 });
  });

  it("is empty when there's nothing to copy", () => {
    expect(copySummary([], new Set())).toEqual({ requests: 0, copies: 0 });
  });
});
