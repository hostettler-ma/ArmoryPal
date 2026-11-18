import { describe, expect, it } from "vitest";
import { embedSize, fitEmbed, fitLines, LIMITS, postState, renderEventPost, renderHash, type RenderData } from "./render-event.ts";

const APP = "https://armorypal.test";
const NOW = new Date("2026-11-18T12:00:00Z");

function data(over: Partial<RenderData> = {}, event: Partial<RenderData["event"]> = {}): RenderData {
  return {
    event: {
      id: "7afd6814-aa2c-490d-a17c-3dac4b852563",
      label: "Thursday Armory",
      event_date: "2026-11-19",
      starts_at: "2026-11-19T23:00:00Z",
      ends_at: "2026-11-20T05:00:00Z",
      cancelled_at: null,
      cancel_note: null,
      format: null,
      one_off: false,
      moved_from: null,
      ...event,
    },
    store: { id: "00000000-0000-4000-a000-0000000e2e01", name: "Uncommons", city: "New York", region: "NY", country: "USA", timezone: "America/New_York" },
    going: [
      { name: "Alice", requests: 2 },
      { name: "Bob", requests: 0 },
      { name: "Carol", requests: 1 },
      { name: "Dan", requests: 0 },
    ],
    not_going: [{ name: "Eve", requests: 1 }],
    open_requests: [
      { card: "Snatch", pitch: 1, remaining: 3, requester: "Alice" },
      { card: "Sink Below", pitch: 3, remaining: 2, requester: "Carol" },
      { card: "Enlightened Strike", pitch: 2, remaining: 1, requester: "Alice" },
      { card: "Nimblism", pitch: 1, remaining: 1, requester: "Eve" },
    ],
    open_count: 4,
    request_count: 5,
    poll: null,
    ...over,
  };
}

const render = (d: RenderData, opts: { now?: Date; linked?: boolean } = {}) =>
  renderEventPost(d, { appUrl: APP, now: opts.now ?? NOW, linked: opts.linked });

const embed = (d: RenderData, opts?: { now?: Date; linked?: boolean }) => render(d, opts).embeds![0];
const field = (d: RenderData, name: string | RegExp) =>
  embed(d).fields!.find((f) => (typeof name === "string" ? f.name === name : name.test(f.name)));
const buttons = (d: RenderData, opts?: { now?: Date; linked?: boolean }) => render(d, opts).components!.flatMap((row) => row.components);

describe("renderEventPost snapshots", () => {
  it("normal", () => expect(render(data())).toMatchSnapshot());
  it("empty", () => expect(render(data({ going: [], not_going: [], open_requests: [], open_count: 0, request_count: 0 }))).toMatchSnapshot());
  it("cancelled", () =>
    expect(render(data({}, { cancelled_at: "2026-11-18T10:00:00Z", cancel_note: "Closed for Thanksgiving" }))).toMatchSnapshot());
  it("ended", () => expect(render(data(), { now: new Date("2026-11-20T06:00:00Z") })).toMatchSnapshot());
  it("one-off, moved", () => expect(render(data({}, { one_off: true, moved_from: "2026-11-18T23:00:00Z" }))).toMatchSnapshot());
  it("format poll open", () =>
    expect(render(data({ poll: { options: ["draft", "cc", "silver_age"], closed_at: null, weekly: true, votes: { draft: 3, cc: 1 } } }))).toMatchSnapshot());
  it("format confirmed", () => expect(render(data({}, { format: "cc" }))).toMatchSnapshot());
});

describe("the post", () => {
  it("never mentions anyone", () => {
    expect(render(data()).allowed_mentions).toEqual({ parse: [] });
  });

  it("links the title to the event and the author to the store", () => {
    const e = embed(data());
    expect(e.url).toBe(`${APP}/events/7afd6814-aa2c-490d-a17c-3dac4b852563`);
    expect(e.author).toEqual({ name: "Uncommons · New York, NY", url: `${APP}/stores/00000000-0000-4000-a000-0000000e2e01` });
    expect(e.color).toBe(0x99c41e);
    expect(e.footer?.text).toBe("ArmoryPal · updates live");
  });

  it("uses Discord timestamps for date, time and countdown", () => {
    expect(field(data(), "📅 Date")?.value).toBe("<t:1795129200:D>");
    expect(field(data(), "⏰ Time")?.value).toBe("<t:1795129200:t>");
    expect(field(data(), "⏳ Starts")?.value).toBe("<t:1795129200:R>");
  });

  it("numbers Going in join order across three columns, with request counts", () => {
    const going = embed(data()).fields!.filter((f) => f.inline && /^(Going|​)/.test(f.name) && /^\d\./.test(f.value));
    expect(going.map((f) => f.value)).toEqual(["1. Alice · 2 req\n2. Bob", "3. Carol · 1 req\n4. Dan"]);
    expect(going[0].name).toBe("Going (4)");
  });

  it("shows the top 3 open requests and how many more", () => {
    expect(field(data(), /^Open requests/)).toEqual({
      name: "Open requests (4)",
      value: `🔴 · 3× Snatch · Alice\n🔵 · 2× Sink Below · Carol\n🟡 · 1× Enlightened Strike · Alice\n+1 more in [ArmoryPal](${APP}/events/7afd6814-aa2c-490d-a17c-3dac4b852563?tab=requests)`,
    });
  });

  it("escapes player text", () => {
    const d = data({ going: [{ name: "**Boss** @everyone", requests: 0 }] }, { label: "[Free](https://evil)" });
    expect(field(d, "Going (1)")?.value).toBe("1. \\*\\*Boss\\*\\* @​everyone");
    // The title is plain text in Discord (no markdown), so it's only truncated.
    expect(embed(d).title).toBe("[Free](https://evil)");
  });

  it("has Going and a red Not going, with Open in ArmoryPal on its own row", () => {
    const rows = render(data()).components!;
    expect(rows.map((row) => row.components.map((b) => [b.label, b.style]))).toEqual([
      [
        ["Going", 3],
        ["Not going", 4],
      ],
      [["Open in ArmoryPal", 5]],
    ]);
  });

  it("turns the buttons off when cancelled, ended or unlinked", () => {
    expect(buttons(data()).map((b) => [b.label, b.disabled ?? false])).toEqual([
      ["Going", false],
      ["Not going", false],
      ["Open in ArmoryPal", false],
    ]);
    const cancelled = data({}, { cancelled_at: "2026-11-18T10:00:00Z" });
    for (const b of [buttons(cancelled), buttons(data(), { now: new Date("2026-11-20T06:00:00Z") }), buttons(data(), { linked: false })]) {
      expect(b.filter((x) => x.custom_id).every((x) => x.disabled)).toBe(true);
      expect(b.find((x) => x.url)?.disabled).toBeUndefined(); // the link always works
    }
    expect(embed(cancelled).color).toBe(0x8a8a8a);
    expect(embed(cancelled).title).toBe("Cancelled · Thursday Armory");
  });

  it("knows its state", () => {
    expect(postState(data(), { now: NOW })).toEqual({ cancelled: false, ended: false, interactive: true });
    expect(postState(data(), { now: NOW, linked: false }).interactive).toBe(false);
  });
});

describe("Discord's size limits", () => {
  const huge = () =>
    data({
      going: Array.from({ length: 300 }, (_, i) => ({ name: `Player with a very long name ${i}`.slice(0, 40), requests: 20 })),
      not_going: Array.from({ length: 150 }, (_, i) => ({ name: `Someone who left ${i}`, requests: 3 })),
      open_requests: Array.from({ length: 50 }, (_, i) => ({ card: `A card with a really quite long name ${i}`, pitch: 2, remaining: 20, requester: "X".repeat(40) })),
      open_count: 500,
    });

  it("a very large event stays within every limit and says how many are hidden", () => {
    const e = embed(huge(), {});
    expect(embedSize(e)).toBeLessThanOrEqual(LIMITS.total);
    expect(e.fields!.length).toBeLessThanOrEqual(LIMITS.fields);
    for (const f of e.fields!) {
      expect(f.value.length).toBeLessThanOrEqual(LIMITS.fieldValue);
      expect(f.name.length).toBeLessThanOrEqual(LIMITS.fieldName);
    }
    expect(field(huge(), "Going (300)")?.value).toMatch(/\+\d+ more in \[ArmoryPal\]/);
    expect(field(huge(), /^Open requests/)?.value).toMatch(/\+497 more in \[ArmoryPal\]/);
  });

  it("very large snapshot", () => expect(render(huge())).toMatchSnapshot());

  it("fitLines keeps whole lines and counts what's hidden", () => {
    expect(fitLines(["aaaa", "bbbb", "cccc"], 100, "u")).toBe("aaaa\nbbbb\ncccc");
    const cut = fitLines(["aaaa", "bbbb", "cccc", "dddd"], 30, "u");
    expect(cut.length).toBeLessThanOrEqual(30);
    expect(cut).toBe("aaaa\n+3 more in [ArmoryPal](u)");
    expect(fitLines(["a"], 100, "u", 5)).toBe("a\n+5 more in [ArmoryPal](u)");
  });

  it("fitEmbed shrinks the longest field until the embed fits", () => {
    const fields = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}`, value: Array.from({ length: 100 }, () => "x".repeat(9)).join("\n").slice(0, 1000) }));
    const fitted = fitEmbed({ title: "t", fields });
    expect(embedSize(fitted)).toBeLessThanOrEqual(LIMITS.total);
  });
});

describe("renderHash", () => {
  it("is stable, and changes when the post changes", () => {
    expect(renderHash(render(data()))).toBe(renderHash(render(data())));
    expect(renderHash(render(data({ going: [] })))).not.toBe(renderHash(render(data())));
    // The countdown is a Discord timestamp, so time passing alone doesn't change the post.
    expect(renderHash(render(data(), { now: new Date("2026-11-19T12:00:00Z") }))).toBe(renderHash(render(data())));
  });
});
