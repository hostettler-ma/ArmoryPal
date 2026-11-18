// Discord REST with the bot token, respecting rate limits
// (docs.discord.com/developers/topics/rate-limits): per-route buckets learned
// from X-RateLimit-* headers, 429 retry_after, and the global limit. Nothing
// is hard-coded. Pure apart from the injected fetch/sleep, so it's unit-tested.

import { DISCORD_API } from "./discord-api.ts";

export type DiscordResponse = {
  ok: boolean;
  /** HTTP status; 0 for a network error. */
  status: number;
  /** Discord's JSON error code (e.g. 10008 Unknown Message). */
  code?: number;
  message?: string;
  body?: unknown;
  /** Seconds to wait before retrying (429, or a bucket that's empty for too long). */
  retryAfter?: number;
  /** A global rate limit: stop all requests for retryAfter. */
  global?: boolean;
};

export type DiscordClient = { request(method: string, path: string, body?: unknown): Promise<DiscordResponse> };

type Bucket = { remaining: number; resetAt: number };

const NETWORK_ATTEMPTS = 3;
const NETWORK_RETRY_MS = [1000, 3000];

/** Errors that happen before anything is sent: DNS lookups and failed connections. */
export function neverSent(error: unknown): boolean {
  return /dns error|name resolution|failed to lookup|\(Connect\)|connection refused|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(String(error));
}

/**
 * The rate-limit key for a route: method + path with IDs replaced, except the
 * "major parameter" (channel, guild or webhook ID), which Discord buckets separately.
 */
export function routeKey(method: string, path: string): string {
  const parts = path.split("?")[0].split("/");
  const out = parts.map((seg, i) => {
    if (!/^\d{15,21}$/.test(seg)) return seg;
    return ["channels", "guilds", "webhooks"].includes(parts[i - 1]) ? seg : ":id";
  });
  return `${method.toUpperCase()} ${out.join("/")}`;
}

export function createDiscordClient(opts: {
  token: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Wait at most this long for an empty bucket; beyond it, report retryAfter instead. */
  maxWaitMs?: number;
}): DiscordClient {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const maxWaitMs = opts.maxWaitMs ?? 5000;
  const routeBucket = new Map<string, string>(); // route → Discord's bucket hash
  const buckets = new Map<string, Bucket>(); // bucket hash + major param → state
  let globalUntil = 0;

  const majorOf = (path: string) => /\/(?:channels|guilds|webhooks)\/(\d+)/.exec(path)?.[1] ?? "";

  return {
    async request(method, path, body) {
      const route = routeKey(method, path);
      const bucketId = routeBucket.get(route);
      const key = bucketId ? `${bucketId}:${majorOf(path)}` : undefined;

      // Wait for (or report) an exhausted bucket or a global limit.
      const state = key ? buckets.get(key) : undefined;
      const waitUntil = Math.max(globalUntil, state && state.remaining <= 0 ? state.resetAt : 0);
      const wait = waitUntil - now();
      if (wait > 0) {
        if (wait > maxWaitMs) return { ok: false, status: 429, retryAfter: wait / 1000, global: globalUntil > now() };
        await sleep(wait);
      }

      let res: Response | undefined;
      for (let attempt = 1; !res; attempt++) {
        try {
          res = await doFetch(`${DISCORD_API}${path}`, {
            method,
            headers: {
              Authorization: `Bot ${opts.token}`,
              "Content-Type": "application/json",
              "User-Agent": "DiscordBot (https://armorypal.vercel.app, 1.0)",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        } catch (e) {
          // Network blips (e.g. DNS not ready right after a restart): retry after 1 s, then 3 s.
          // A POST is retried only if it can't have reached Discord, so a post is never sent twice.
          if (attempt >= NETWORK_ATTEMPTS || (method.toUpperCase() === "POST" && !neverSent(e))) {
            return { ok: false, status: 0, message: String(e) };
          }
          await sleep(NETWORK_RETRY_MS[attempt - 1]);
        }
      }

      // Learn the bucket from the headers.
      const h = res.headers;
      const hash = h.get("X-RateLimit-Bucket");
      if (hash) {
        routeBucket.set(route, hash);
        const remaining = Number(h.get("X-RateLimit-Remaining"));
        const resetAfter = Number(h.get("X-RateLimit-Reset-After"));
        if (Number.isFinite(remaining) && Number.isFinite(resetAfter)) {
          buckets.set(`${hash}:${majorOf(path)}`, { remaining, resetAt: now() + resetAfter * 1000 });
        }
      }

      const text = res.status === 204 ? "" : await res.text();
      let json: Record<string, unknown> | undefined;
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
      } catch {
        json = undefined;
      }

      if (res.status === 429) {
        const retryAfter = Number(json?.retry_after ?? h.get("Retry-After") ?? 1);
        const global = json?.global === true || h.get("X-RateLimit-Global") === "true";
        if (global) globalUntil = now() + retryAfter * 1000;
        else if (hash) buckets.set(`${hash}:${majorOf(path)}`, { remaining: 0, resetAt: now() + retryAfter * 1000 });
        return { ok: false, status: 429, retryAfter, global, code: json?.code as number | undefined };
      }
      if (!res.ok) {
        return { ok: false, status: res.status, code: json?.code as number | undefined, message: (json?.message as string) ?? text.slice(0, 200) };
      }
      return { ok: true, status: res.status, body: json };
    },
  };
}

export type Outcome = "ok" | "gone" | "broken" | "undeliverable" | "rate" | "retry" | "fail";

/** Discord won't DM this user: 50007 (privacy settings or a block), 50278 (no server in common). */
export const UNDELIVERABLE_CODES = [50007, 50278];

/** What a failed call means for ArmoryBot. */
export function classify(res: DiscordResponse): Outcome {
  if (res.ok) return "ok";
  if (res.status === 429) return "rate";
  if (res.code === 40003) return "rate"; // opening DMs too fast
  if (res.code !== undefined && UNDELIVERABLE_CODES.includes(res.code)) return "undeliverable";
  if (res.status === 0 || res.status >= 500) return "retry";
  if (res.code === 10008) return "gone"; // Unknown Message
  if (res.code === 10003 || res.code === 10004 || res.code === 50001 || res.code === 50013 || res.status === 403) return "broken";
  if (res.status === 404) return "gone";
  return "fail";
}

/** A short reason for /armory status, from Discord's error. */
export function brokenReason(res: DiscordResponse): string {
  const known: Record<number, string> = {
    10003: "the channel was deleted",
    10004: "the bot was removed from the server",
    50001: "the bot can't see the channel",
    50013: "the bot is missing Send Messages or Embed Links",
  };
  return (res.code && known[res.code]) || res.message || `HTTP ${res.status}`;
}
