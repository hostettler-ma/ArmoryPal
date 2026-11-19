import { describe, expect, it } from "vitest";
import type { Rpc } from "./db.ts";
import type { DiscordClient, DiscordResponse } from "./discord-rest.ts";
import { renderEventPost, renderHash, type RenderData } from "./render-event.ts";
import { runWorker } from "./worker.ts";

const APP = "https://armorypal.test";
const NOW = new Date("2026-11-18T12:00:00Z");
const EVENT = "7afd6814-aa2c-490d-a17c-3dac4b852563";

const renderData = (event: Partial<RenderData["event"]> = {}): RenderData => ({
  event: {
    id: EVENT,
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
  store: { id: "s", name: "Uncommons", city: "New York", region: "NY", country: "USA", timezone: "America/New_York" },
  going: [{ name: "Alice", requests: 0 }],
  not_going: [],
  open_requests: [],
  open_count: 0,
  request_count: 0,
  poll: null,
});

/** A fake database whose queues empty after the first read, and that records every call. */
function setup(opts: {
  due?: object[];
  outbox?: object[];
  dms?: object[];
  render?: RenderData | null;
  targets?: object[];
  recordPost?: boolean;
  discord?: (method: string, path: string) => DiscordResponse;
}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const queues: Record<string, object[][]> = { bot_due_posts: [opts.due ?? []], bot_claim_outbox: [opts.outbox ?? []], bot_claim_dm_batches: [opts.dms ?? []] };
  const rpc: Rpc = async (name, args) => {
    calls.push({ name, args });
    if (name in queues) return { data: (queues[name].shift() ?? []) as never, error: null };
    if (name === "bot_render_event") return { data: (opts.render === undefined ? renderData() : opts.render) as never, error: null };
    if (name === "bot_post_targets") return { data: (opts.targets ?? []) as never, error: null };
    if (name === "bot_record_post") return { data: (opts.recordPost ?? true) as never, error: null };
    if (name === "bot_next_outbox_in") return { data: null as never, error: null };
    return { data: null as never, error: null };
  };
  const requests: { method: string; path: string; body?: unknown }[] = [];
  const discord: DiscordClient = {
    async request(method, path, body) {
      requests.push({ method, path, body });
      return opts.discord?.(method, path) ?? { ok: true, status: 200, body: { id: "555" } };
    },
  };
  const run = () =>
    runWorker({ rpc, discord, appUrl: APP, now: () => NOW, sleep: async () => {}, deadline: Date.now() + 10_000 });
  const named = (n: string) => calls.filter((c) => c.name === n).map((c) => c.args);
  return { run, calls, named, requests };
}

describe("scheduled posts", () => {
  it("posts a due event and records the message", async () => {
    const w = setup({ due: [{ guild_id: "g", event_id: EVENT, channel_id: "c" }] });
    const report = await w.run();
    expect(w.requests[0]).toMatchObject({ method: "POST", path: "/channels/c/messages" });
    expect(w.named("bot_record_post")).toEqual([
      { p_guild_id: "g", p_event_id: EVENT, p_message_id: "555", p_render_hash: renderHash(renderEventPost(renderData(), { appUrl: APP, now: NOW, linked: true })) },
    ]);
    expect(report).toMatchObject({ posted: 1, stopped: "idle" });
  });

  it("deletes the message again if the event was deleted while posting", async () => {
    const w = setup({ due: [{ guild_id: "g", event_id: EVENT, channel_id: "c" }], recordPost: false });
    await w.run();
    expect(w.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /channels/c/messages", "DELETE /channels/c/messages/555"]);
    expect(w.named("bot_post_gone")).toEqual([{ p_guild_id: "g", p_event_id: EVENT }]);
  });

  it("marks the link broken and releases the claim when the bot can't post", async () => {
    const w = setup({
      due: [{ guild_id: "g", event_id: EVENT, channel_id: "c" }],
      discord: () => ({ ok: false, status: 403, code: 50013, message: "Missing Permissions" }),
    });
    const report = await w.run();
    expect(w.named("bot_mark_broken")).toEqual([
      { p_guild_id: "g", p_channel_id: "c", p_reason: "the bot is missing Send Messages or Embed Links" },
    ]);
    expect(w.named("bot_release_post")).toEqual([{ p_guild_id: "g", p_event_id: EVENT }]);
    expect(report.broken).toBe(1);
  });

  it("keeps the claim on a Discord outage (retried after 5 minutes)", async () => {
    const w = setup({ due: [{ guild_id: "g", event_id: EVENT, channel_id: "c" }], discord: () => ({ ok: false, status: 503 }) });
    await w.run();
    expect(w.named("bot_release_post")).toEqual([]);
  });
});

describe("outbox rows", () => {
  const target = (over: object = {}) => ({ guild_id: "g", channel_id: "c", message_id: "m", render_hash: null, linked: true, broken: false, ...over });

  it("edits each live post and completes the row", async () => {
    const w = setup({ outbox: [{ id: 1, kind: "refresh", event_id: EVENT, payload: {} }], targets: [target(), target({ guild_id: "g2", channel_id: "c2", message_id: "m2" })] });
    const report = await w.run();
    expect(w.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["PATCH /channels/c/messages/m", "PATCH /channels/c2/messages/m2"]);
    expect(w.named("bot_complete_outbox")).toEqual([{ p_ids: [1] }]);
    expect(report.edited).toBe(2);
  });

  it("skips posts whose render didn't change, and broken channels", async () => {
    const hash = renderHash(renderEventPost(renderData(), { appUrl: APP, now: NOW, linked: true }));
    const w = setup({ outbox: [{ id: 1, kind: "refresh", event_id: EVENT, payload: {} }], targets: [target({ render_hash: hash }), target({ broken: true })] });
    const report = await w.run();
    expect(w.requests).toEqual([]);
    expect(report.unchanged).toBe(1);
  });

  it("finalizes ended events (buttons off, no more edits)", async () => {
    const w = setup({
      outbox: [{ id: 1, kind: "refresh", event_id: EVENT, payload: {} }],
      render: renderData({ ends_at: "2026-11-18T11:00:00Z" }),
      targets: [target()],
    });
    await w.run();
    const body = w.requests[0].body as { components: { components: { disabled?: boolean }[] }[] };
    expect(body.components[0].components.every((b) => b.disabled)).toBe(true);
    expect(w.named("bot_record_render")[0]).toMatchObject({ p_finalize: true });
  });

  it("finalizes posts in servers that unlinked the store", async () => {
    const w = setup({ outbox: [{ id: 1, kind: "refresh", event_id: EVENT, payload: {} }], targets: [target({ linked: false })] });
    await w.run();
    expect(w.named("bot_record_render")[0]).toMatchObject({ p_finalize: true });
  });

  it("marks a post gone when a moderator deleted it", async () => {
    const w = setup({
      outbox: [{ id: 1, kind: "moved", event_id: EVENT, payload: {} }],
      targets: [target()],
      discord: () => ({ ok: false, status: 404, code: 10008, message: "Unknown Message" }),
    });
    await w.run();
    expect(w.named("bot_post_gone")).toEqual([{ p_guild_id: "g", p_event_id: EVENT }]);
    expect(w.named("bot_complete_outbox")).toHaveLength(1);
  });

  it("retries the row after Discord's retry_after on a rate limit", async () => {
    const w = setup({
      outbox: [{ id: 7, kind: "refresh", event_id: EVENT, payload: {} }],
      targets: [target()],
      discord: () => ({ ok: false, status: 429, retryAfter: 4.2 }),
    });
    await w.run();
    expect(w.named("bot_fail_outbox")).toEqual([{ p_id: 7, p_error: "rate limited or Discord error", p_retry_seconds: 4.2 }]);
    expect(w.named("bot_complete_outbox")).toEqual([]);
  });

  it("stops the run on a global rate limit", async () => {
    const w = setup({
      outbox: [{ id: 1, kind: "refresh", event_id: EVENT, payload: {} }, { id: 2, kind: "refresh", event_id: EVENT, payload: {} }],
      targets: [target()],
      discord: () => ({ ok: false, status: 429, retryAfter: 30, global: true }),
    });
    const report = await w.run();
    expect(w.requests).toHaveLength(1);
    expect(w.named("bot_fail_outbox").map((a) => a.p_id)).toEqual([1, 2]);
    expect(report.stopped).toBe("global_rate_limit");
  });

  it("deletes the messages of a deleted event", async () => {
    const posts = [
      { guild_id: "g", channel_id: "c", message_id: "m" },
      { guild_id: "g2", channel_id: "c2", message_id: "m2" },
    ];
    const w = setup({
      outbox: [{ id: 3, kind: "delete_posts", event_id: EVENT, payload: { posts } }],
      discord: (_m, path) => (path.includes("c2") ? { ok: false, status: 404, code: 10008 } : { ok: true, status: 204 }),
    });
    const report = await w.run();
    expect(w.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["DELETE /channels/c/messages/m", "DELETE /channels/c2/messages/m2"]);
    expect(w.named("bot_post_gone")).toHaveLength(2);
    expect(w.named("bot_complete_outbox")).toEqual([{ p_ids: [3] }]);
    expect(report.deleted).toBe(1);
  });

  it("completes rows for events that no longer exist", async () => {
    const w = setup({ outbox: [{ id: 1, kind: "refresh", event_id: EVENT, payload: {} }], render: null });
    await w.run();
    expect(w.requests).toEqual([]);
    expect(w.named("bot_complete_outbox")).toEqual([{ p_ids: [1] }]);
  });
});

describe("DMs", () => {
  const batch = (over: object = {}) => ({
    user_id: "u1",
    discord_id: "111",
    items: [
      {
        id: 10,
        kind: "new_requests",
        payload: { actor: "Alice", card: "Snatch (Red)", items: 1, copies: 2 },
        created_at: "2026-11-18T11:58:00Z",
        event: { id: EVENT, label: "Thursday Armory", starts_at: "2026-11-19T23:00:00Z", store: "Uncommons" },
      },
      { id: 11, kind: "card_needed_again", payload: { actor: "Bob", card: "Sink Below (Blue)", items: 1, copies: 1, reason: "unpledged" }, created_at: "2026-11-18T11:59:00Z", event: { id: EVENT, label: "Thursday Armory", starts_at: "2026-11-19T23:00:00Z", store: "Uncommons" } },
    ],
    ...over,
  });

  it("opens the DM channel, sends one message for the whole batch and marks it sent", async () => {
    const w = setup({
      dms: [batch()],
      discord: (_m, path) => (path === "/users/@me/channels" ? { ok: true, status: 200, body: { id: "dm-chan" } } : { ok: true, status: 200, body: { id: "msg" } }),
    });
    const report = await w.run();
    expect(w.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /users/@me/channels", "POST /channels/dm-chan/messages"]);
    expect(w.requests[0].body).toEqual({ recipient_id: "111" });
    expect((w.requests[1].body as { content: string }).content).toContain("Alice needs 2× Snatch");
    expect(w.named("bot_complete_dm_batch")).toEqual([{ p_ids: [10, 11] }]);
    expect(report.dms).toBe(1);
  });

  it("records players Discord won't let us DM, without retrying", async () => {
    for (const code of [50007, 50278]) {
      const w = setup({ dms: [batch()], discord: () => ({ ok: false, status: 403, code, message: "Cannot send messages to this user" }) });
      const report = await w.run();
      expect(w.named("bot_dm_undeliverable")).toEqual([{ p_ids: [10, 11], p_code: code }]);
      expect(w.named("bot_retry_dm_batch")).toEqual([]);
      expect(report.undeliverable).toBe(1);
    }
  });

  it("retries later on rate limits, opening DMs too fast, and outages", async () => {
    for (const res of [
      { ok: false, status: 429, retryAfter: 3 },
      { ok: false, status: 400, code: 40003, message: "You are opening direct messages too fast." },
      { ok: false, status: 503 },
    ]) {
      const w = setup({ dms: [batch()], discord: () => res });
      await w.run();
      expect(w.named("bot_retry_dm_batch")).toEqual([{ p_ids: [10, 11], p_retry_seconds: res.retryAfter ?? 30 }]);
    }
  });

  it("drops a batch Discord rejects for another reason", async () => {
    const w = setup({ dms: [batch()], discord: () => ({ ok: false, status: 400, code: 50035, message: "Invalid Form Body" }) });
    await w.run();
    expect(w.named("bot_retry_dm_batch")).toEqual([{ p_ids: [10, 11], p_retry_seconds: 0, p_drop_reason: "discord_50035" }]);
  });

  it("reuses a player's DM channel within a run", async () => {
    const w = setup({
      dms: [batch(), batch({ user_id: "u1", items: [{ ...batch().items[0], id: 12 }] })],
      discord: (_m, path) => (path === "/users/@me/channels" ? { ok: true, status: 200, body: { id: "dm-chan" } } : { ok: true, status: 200, body: { id: "msg" } }),
    });
    await w.run();
    expect(w.requests.filter((r) => r.path === "/users/@me/channels")).toHaveLength(1);
  });
});
