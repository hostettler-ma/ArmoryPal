import { describe, expect, it } from "vitest";
import { classify, createDiscordClient, neverSent, routeKey } from "./discord-rest.ts";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

function fakeDiscord(replies: Reply[]) {
  const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
  let clock = 1_000_000;
  const slept: number[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method!, body: init.body as string, auth: (init.headers as Record<string, string>).Authorization });
    const r = replies.shift() ?? { status: 200, body: {} };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  }) as unknown as typeof globalThis.fetch;
  const client = createDiscordClient({
    token: "tok",
    fetch,
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
  });
  return { client, calls, slept, advance: (ms: number) => (clock += ms) };
}

describe("routeKey", () => {
  it("keeps the major parameter and hides other IDs", () => {
    expect(routeKey("patch", "/channels/123456789012345678/messages/223456789012345678")).toBe(
      "PATCH /channels/123456789012345678/messages/:id",
    );
    expect(routeKey("POST", "/users/@me/channels")).toBe("POST /users/@me/channels");
  });
});

describe("createDiscordClient", () => {
  it("sends the bot token and JSON", async () => {
    const d = fakeDiscord([{ status: 200, body: { id: "9" } }]);
    const res = await d.client.request("POST", "/channels/123456789012345678/messages", { content: "hi" });
    expect(res).toEqual({ ok: true, status: 200, body: { id: "9" } });
    expect(d.calls[0]).toMatchObject({ method: "POST", auth: "Bot tok", body: '{"content":"hi"}' });
    expect(d.calls[0].url).toBe("https://discord.com/api/v10/channels/123456789012345678/messages");
  });

  it("waits for an exhausted bucket before the next call on the same route", async () => {
    const limited = { "X-RateLimit-Bucket": "abc", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "1.5" };
    const d = fakeDiscord([{ status: 200, body: {}, headers: limited }, { status: 200, body: {} }]);
    await d.client.request("PATCH", "/channels/123456789012345678/messages/1234567890123456789", {});
    await d.client.request("PATCH", "/channels/123456789012345678/messages/9234567890123456789", {});
    expect(d.slept).toEqual([1500]);
  });

  it("buckets per channel (major parameter)", async () => {
    const limited = { "X-RateLimit-Bucket": "abc", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "3" };
    const d = fakeDiscord([{ status: 200, body: {}, headers: limited }, { status: 200, body: {} }]);
    await d.client.request("PATCH", "/channels/111111111111111111/messages/1234567890123456789", {});
    await d.client.request("PATCH", "/channels/222222222222222222/messages/1234567890123456789", {});
    expect(d.slept).toEqual([]);
  });

  it("reports long waits instead of sleeping through them", async () => {
    const limited = { "X-RateLimit-Bucket": "abc", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset-After": "60" };
    const d = fakeDiscord([{ status: 200, body: {}, headers: limited }]);
    await d.client.request("POST", "/channels/123456789012345678/messages", {});
    const res = await d.client.request("POST", "/channels/123456789012345678/messages", {});
    expect(res).toMatchObject({ ok: false, status: 429, retryAfter: 60 });
    expect(d.calls).toHaveLength(1);
  });

  it("returns 429 retry_after, and blocks everything on a global limit", async () => {
    const d = fakeDiscord([
      { status: 429, body: { message: "You are being rate limited.", retry_after: 2.5, global: false } },
      { status: 429, body: { message: "global", retry_after: 30, global: true } },
    ]);
    expect(await d.client.request("POST", "/channels/123456789012345678/messages", {})).toMatchObject({ status: 429, retryAfter: 2.5, global: false });
    expect(await d.client.request("POST", "/channels/923456789012345678/messages", {})).toMatchObject({ status: 429, retryAfter: 30, global: true });
    // Any route now waits for the global limit (longer than maxWait → reported, not sent).
    const res = await d.client.request("DELETE", "/channels/1/messages/2");
    expect(res).toMatchObject({ ok: false, status: 429, global: true });
    expect(d.calls).toHaveLength(2);
  });

  it("passes Discord's error codes through", async () => {
    const d = fakeDiscord([{ status: 404, body: { message: "Unknown Message", code: 10008 } }]);
    const res = await d.client.request("PATCH", "/channels/123456789012345678/messages/1", {});
    expect(res).toMatchObject({ ok: false, status: 404, code: 10008, message: "Unknown Message" });
  });

  // The error Deno gave on a fresh local runtime (Docker DNS not ready yet).
  const DNS_ERROR = new TypeError(
    "error sending request for url (https://discord.com/api/v10/channels/1/messages): client error (Connect): dns error: failed to lookup address information: Temporary failure in name resolution",
  );
  const RESET_ERROR = new TypeError("error sending request: connection closed before message completed");

  function flaky(errors: Error[]) {
    let calls = 0;
    const slept: number[] = [];
    const client = createDiscordClient({
      token: "t",
      fetch: (async () => {
        calls++;
        const e = errors.shift();
        if (e) throw e;
        return new Response(JSON.stringify({ id: "1" }), { status: 200 });
      }) as unknown as typeof fetch,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    return { client, slept, calls: () => calls };
  }

  it("retries network errors after 1 s and 3 s, then gives up with status 0", async () => {
    const ok = flaky([DNS_ERROR, DNS_ERROR]);
    expect(await ok.client.request("POST", "/channels/1/messages", {})).toMatchObject({ ok: true });
    expect(ok.slept).toEqual([1000, 3000]);

    const down = flaky([DNS_ERROR, DNS_ERROR, DNS_ERROR]);
    expect(await down.client.request("PATCH", "/channels/1/messages/2", {})).toMatchObject({ ok: false, status: 0 });
    expect(down.calls()).toBe(3);
  });

  it("never retries a POST that may already have reached Discord (no double posts)", async () => {
    const post = flaky([RESET_ERROR]);
    expect(await post.client.request("POST", "/channels/1/messages", {})).toMatchObject({ ok: false, status: 0 });
    expect(post.calls()).toBe(1);
    // Edits and deletes are safe to repeat.
    const edit = flaky([RESET_ERROR]);
    expect(await edit.client.request("PATCH", "/channels/1/messages/2", {})).toMatchObject({ ok: true });
  });

  it("recognises errors from before anything was sent", () => {
    expect(neverSent(DNS_ERROR)).toBe(true);
    expect(neverSent(new Error("connect ECONNREFUSED 1.2.3.4:443"))).toBe(true);
    expect(neverSent(RESET_ERROR)).toBe(false);
  });
});

describe("classify", () => {
  it("maps Discord errors to what ArmoryBot does next", () => {
    expect(classify({ ok: true, status: 200 })).toBe("ok");
    expect(classify({ ok: false, status: 429 })).toBe("rate");
    expect(classify({ ok: false, status: 502 })).toBe("retry");
    expect(classify({ ok: false, status: 0 })).toBe("retry");
    expect(classify({ ok: false, status: 404, code: 10008 })).toBe("gone");
    expect(classify({ ok: false, status: 404, code: 10003 })).toBe("broken");
    expect(classify({ ok: false, status: 403, code: 50013 })).toBe("broken");
    expect(classify({ ok: false, status: 403, code: 50001 })).toBe("broken");
    expect(classify({ ok: false, status: 400, code: 50035 })).toBe("fail");
  });
});
