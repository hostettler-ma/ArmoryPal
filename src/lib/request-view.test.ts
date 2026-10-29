import { describe, expect, it } from "vitest";
import { buildRequestViews, type LoadedRequest } from "./request-view";

const ME = "me";
const card = (color: "Red" | "Blue") => ({ id: `c-${color}`, name: "Snatch", pitch: color === "Red" ? 1 : 3, color, types: [] });

const req = (id: string, over: Partial<LoadedRequest> = {}): LoadedRequest => ({
  id,
  quantity: 2,
  note: null,
  requester_id: "alice",
  created_at: `2026-11-01T10:00:0${id.length}Z`,
  card: card("Red"),
  requester: { display_name: "Alice" },
  pledges: [],
  ...over,
});
const pledge = (pledger_id: string, quantity: number) => ({ pledger_id, quantity, pledger: { display_name: pledger_id } });

const viewer = { id: ME, attending: true, eventEnded: false };

describe("buildRequestViews", () => {
  it("computes pledged, remaining, coverage, and my pledge", () => {
    const [v] = buildRequestViews([req("r", { quantity: 3, pledges: [pledge(ME, 1), pledge("bob", 1)] })], viewer);
    expect(v).toMatchObject({ pledged: 2, remaining: 1, coverage: "partial", myPledge: 1, maxPledge: 2 });
    expect(v.canPledge).toEqual({ ok: true });
    expect(v.pledgers.map((p) => p.name)).toEqual([ME, "bob"]);
  });

  it("marks my own requests and blocks pledging on them", () => {
    const [v] = buildRequestViews([req("r", { requester_id: ME })], viewer);
    expect(v.isMine).toBe(true);
    expect(v.canPledge).toEqual({ ok: false, reason: "own_request" });
  });

  it("blocks pledging for non-attendees and after the event", () => {
    expect(buildRequestViews([req("r")], { ...viewer, attending: false })[0].canPledge).toEqual({
      ok: false,
      reason: "not_attending",
    });
    expect(buildRequestViews([req("r")], { ...viewer, eventEnded: true })[0].canPledge).toEqual({
      ok: false,
      reason: "event_ended",
    });
  });

  it("sorts open before partial before covered, then by most remaining, then oldest", () => {
    const views = buildRequestViews(
      [
        req("covered", { quantity: 1, pledges: [pledge("bob", 1)] }),
        req("partial", { quantity: 3, pledges: [pledge("bob", 1)] }),
        req("open-1", { quantity: 1 }),
        req("open-3", { quantity: 3 }),
        req("open-3b", { quantity: 3, card: card("Blue") }),
      ],
      viewer,
    );
    expect(views.map((v) => v.id)).toEqual(["open-3", "open-3b", "open-1", "partial", "covered"]);
  });

  it("drops rows whose card is missing", () => {
    expect(buildRequestViews([req("r", { card: null })], viewer)).toEqual([]);
  });
});
