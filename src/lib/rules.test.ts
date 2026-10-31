import { describe, expect, it } from "vitest";
import {
  canAddRequest,
  canPledge,
  checkPledgeQuantity,
  checkRequestQuantity,
  checkRequestUpdate,
  coverage,
  maxPledge,
  ruleMessage,
  totalPledged,
  type PledgeContext,
} from "./rules";

const ctx = (over: Partial<PledgeContext> = {}): PledgeContext => ({
  eventEnded: false,
  viewerAttending: true,
  viewerIsRequester: false,
  requestActive: true,
  requestQuantity: 3,
  pledged: 0,
  myPledge: 0,
  ...over,
});

describe("coverage", () => {
  it.each([
    [3, 0, "open"],
    [3, 1, "partial"],
    [3, 2, "partial"],
    [3, 3, "covered"],
    [3, 4, "covered"], // can only happen if data drifts; still "covered"
  ] as const)("%i requested, %i pledged → %s", (q, p, expected) => expect(coverage(q, p)).toBe(expected));

  it("sums pledges", () => {
    expect(totalPledged([{ quantity: 1 }, { quantity: 2 }])).toBe(3);
    expect(totalPledged([])).toBe(0);
  });
});

describe("maxPledge", () => {
  it("is what's still needed when I haven't pledged", () => {
    expect(maxPledge({ requestQuantity: 3, pledged: 1, myPledge: 0 })).toBe(2);
  });

  it("counts my own pledge as replaceable", () => {
    // 3 needed, I pledged 2, someone else 1 → I can go up to 2 (not 3)
    expect(maxPledge({ requestQuantity: 3, pledged: 3, myPledge: 2 })).toBe(2);
  });

  it("is 0 when others covered it", () => {
    expect(maxPledge({ requestQuantity: 2, pledged: 2, myPledge: 0 })).toBe(0);
  });
});

describe("canPledge (permission rules)", () => {
  it("allows an attendee to pledge for someone else's open request", () => {
    expect(canPledge(ctx())).toEqual({ ok: true });
  });

  it.each([
    ["event ended", { eventEnded: true }, "event_ended"],
    ["not attending", { viewerAttending: false }, "not_attending"],
    ["own request", { viewerIsRequester: true }, "own_request"],
    ["cancelled request", { requestActive: false }, "request_cancelled"],
    ["fully covered by others", { pledged: 3 }, "exceeds_remaining"],
  ] as const)("rejects when %s", (_label, over, reason) => {
    expect(canPledge(ctx(over))).toEqual({ ok: false, reason });
  });

  it("checks ended before attendance (most fundamental reason first)", () => {
    expect(canPledge(ctx({ eventEnded: true, viewerAttending: false }))).toEqual({ ok: false, reason: "event_ended" });
  });

  it("still lets me adjust my pledge on a request I helped cover", () => {
    expect(canPledge(ctx({ pledged: 3, myPledge: 1 }))).toEqual({ ok: true });
  });
});

describe("checkPledgeQuantity", () => {
  it("accepts a partial or full pledge", () => {
    expect(checkPledgeQuantity(ctx(), 1).ok).toBe(true);
    expect(checkPledgeQuantity(ctx(), 3).ok).toBe(true);
  });

  it("rejects more than what's still needed", () => {
    expect(checkPledgeQuantity(ctx({ pledged: 2 }), 2)).toEqual({ ok: false, reason: "exceeds_remaining" });
  });

  it.each([0, -1, 1.5, NaN])("rejects quantity %s", (q) => {
    expect(checkPledgeQuantity(ctx(), q)).toEqual({ ok: false, reason: "invalid_quantity" });
  });
});

describe("requests", () => {
  it("only attendees of open events may add requests", () => {
    expect(canAddRequest({ eventEnded: false, viewerAttending: true }).ok).toBe(true);
    expect(canAddRequest({ eventEnded: false, viewerAttending: false })).toEqual({ ok: false, reason: "not_attending" });
    expect(canAddRequest({ eventEnded: true, viewerAttending: true })).toEqual({ ok: false, reason: "event_ended" });
  });

  it.each([[1, true], [20, true], [0, false], [21, false], [2.5, false]])("quantity %s valid=%s", (q, valid) => {
    expect(checkRequestQuantity(q).ok).toBe(valid);
  });

  const upd = { eventEnded: false, viewerIsRequester: true, requestActive: true, pledged: 2 };

  it("lets the requester lower quantity down to what's pledged, not below", () => {
    expect(checkRequestUpdate(upd, 2).ok).toBe(true);
    expect(checkRequestUpdate(upd, 1)).toEqual({ ok: false, reason: "below_pledged" });
  });

  it("rejects updates by others, on cancelled requests, or after the event", () => {
    expect(checkRequestUpdate({ ...upd, viewerIsRequester: false }, 3)).toEqual({ ok: false, reason: "not_owner" });
    expect(checkRequestUpdate({ ...upd, requestActive: false }, 3)).toEqual({ ok: false, reason: "request_cancelled" });
    expect(checkRequestUpdate({ ...upd, eventEnded: true }, 3)).toEqual({ ok: false, reason: "event_ended" });
  });
});

describe("ruleMessage", () => {
  it("maps known codes and falls back for unknown errors", () => {
    expect(ruleMessage("own_request")).toMatch(/your own request/);
    expect(ruleMessage("cannot_ban_admin")).toMatch(/Remove their admin rights first/);
    expect(ruleMessage("banned")).toBe("Your account is suspended.");
    expect(ruleMessage("duplicate key value violates…")).toBe("Something went wrong. Try again.");
    expect(ruleMessage(undefined)).toBe("Something went wrong. Try again.");
  });
});
