// What the discord-worker function does on each run: post what's due, apply
// queued outbox rows (edit / cancel / move / delete posts), then wait briefly
// for debounced rows or stop. Pure apart from the injected rpc, Discord client,
// clock and sleep, so it's unit-tested with fakes.

import type { Rpc } from "./db.ts";
import { brokenReason, classify, type DiscordClient, type DiscordResponse } from "./discord-rest.ts";
import { batchDms, type DmBatch } from "./dm.ts";
import { postState, renderEventPost, renderHash, type RenderData } from "./render-event.ts";

export type WorkerDeps = {
  rpc: Rpc;
  discord: DiscordClient;
  appUrl: string;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Stop starting new work after this time (epoch ms). */
  deadline: number;
};

export type WorkerReport = {
  posted: number;
  edited: number;
  unchanged: number;
  deleted: number;
  gone: number;
  broken: number;
  dms: number;
  undeliverable: number;
  failed: number;
  stopped: "idle" | "deadline" | "global_rate_limit";
};

type PostRow = { guild_id: string; event_id: string; channel_id: string };
type OutboxRow = { id: number; kind: string; event_id: string; payload: { posts?: { guild_id: string; channel_id: string; message_id: string }[] } };
type Target = { guild_id: string; channel_id: string; message_id: string; render_hash: string | null; linked: boolean; broken: boolean };

/** Wait for a debounced outbox row if it's due within this many seconds. */
const IDLE_WAIT_SECONDS = 5;
/** Retry delay for Discord 5xx / network errors. */
const RETRY_SECONDS = 30;

async function must<T>(rpc: Rpc, name: string, args: Record<string, unknown>): Promise<T> {
  const res = await rpc<T>(name, args);
  if (res.error) throw new Error(`${name}: ${res.error.message}`);
  return res.data;
}

export async function runWorker(deps: WorkerDeps): Promise<WorkerReport> {
  const { rpc, discord } = deps;
  const report: WorkerReport = { posted: 0, edited: 0, unchanged: 0, deleted: 0, gone: 0, broken: 0, dms: 0, undeliverable: 0, failed: 0, stopped: "idle" };
  let globalStop = false;

  const noteFailure = async (res: DiscordResponse, where: { guild: string; channel?: string; event?: string }) => {
    const outcome = classify(res);
    if (res.global) globalStop = true;
    if (outcome === "broken") {
      report.broken++;
      // Unknown Guild (bot removed): every link in the server; otherwise this channel.
      await must(rpc, "bot_mark_broken", {
        p_guild_id: where.guild,
        p_channel_id: res.code === 10004 ? null : (where.channel ?? null),
        p_reason: brokenReason(res),
      });
    } else if (outcome === "gone" && where.event) {
      report.gone++;
      await must(rpc, "bot_post_gone", { p_guild_id: where.guild, p_event_id: where.event });
    } else if (outcome !== "rate") {
      report.failed++;
      console.error("discord request failed", res.status, res.code, res.message);
    }
    return outcome;
  };

  // Scheduled posts ------------------------------------------------------------------
  async function createPost(post: PostRow) {
    const data = await must<RenderData | null>(rpc, "bot_render_event", { p_event_id: post.event_id });
    if (!data) {
      await must(rpc, "bot_release_post", { p_guild_id: post.guild_id, p_event_id: post.event_id });
      return;
    }
    const message = renderEventPost(data, { appUrl: deps.appUrl, now: deps.now(), linked: true });
    const res = await discord.request("POST", `/channels/${post.channel_id}/messages`, message);
    if (!res.ok) {
      const outcome = await noteFailure(res, { guild: post.guild_id, channel: post.channel_id });
      // A broken channel or a bad request: drop the claim so it's retried once fixed.
      // Rate limits and Discord outages: keep it; it's handed out again in 5 minutes.
      if (outcome === "broken" || outcome === "fail") {
        await must(rpc, "bot_release_post", { p_guild_id: post.guild_id, p_event_id: post.event_id });
      }
      return;
    }
    const messageId = (res.body as { id: string }).id;
    const stillWanted = await must<boolean>(rpc, "bot_record_post", {
      p_guild_id: post.guild_id,
      p_event_id: post.event_id,
      p_message_id: messageId,
      p_render_hash: renderHash(message),
    });
    report.posted++;
    if (!stillWanted) {
      // The event was deleted while we were posting.
      await discord.request("DELETE", `/channels/${post.channel_id}/messages/${messageId}`);
      await must(rpc, "bot_post_gone", { p_guild_id: post.guild_id, p_event_id: post.event_id });
    }
  }

  // Outbox rows -------------------------------------------------------------------------
  async function applyRow(row: OutboxRow): Promise<{ retryAfter?: number; giveUp?: boolean }> {
    if (row.kind === "delete_posts") {
      let retryAfter = 0;
      for (const p of row.payload.posts ?? []) {
        const res = await discord.request("DELETE", `/channels/${p.channel_id}/messages/${p.message_id}`);
        const outcome = res.ok ? "ok" : classify(res);
        if (outcome === "ok" || outcome === "gone" || outcome === "broken") {
          report.deleted += outcome === "ok" ? 1 : 0;
          await must(rpc, "bot_post_gone", { p_guild_id: p.guild_id, p_event_id: row.event_id });
        } else if (outcome === "rate" || outcome === "retry") {
          if (res.global) globalStop = true;
          retryAfter = Math.max(retryAfter, res.retryAfter ?? RETRY_SECONDS);
        } else {
          report.failed++;
        }
      }
      return retryAfter ? { retryAfter } : {};
    }

    // refresh / moved / cancelled: re-render every live post of the event.
    const data = await must<RenderData | null>(rpc, "bot_render_event", { p_event_id: row.event_id });
    if (!data) return {}; // deleted: a delete_posts row handles its messages
    const targets = await must<Target[]>(rpc, "bot_post_targets", { p_event_id: row.event_id });
    let retryAfter = 0;
    for (const t of targets) {
      if (t.broken) continue;
      const now = deps.now();
      const message = renderEventPost(data, { appUrl: deps.appUrl, now, linked: t.linked });
      const hash = renderHash(message);
      const state = postState(data, { now, linked: t.linked });
      const finalize = !state.interactive && (state.ended || !t.linked);
      if (hash === t.render_hash) {
        report.unchanged++;
        if (finalize) await must(rpc, "bot_record_render", { p_guild_id: t.guild_id, p_event_id: row.event_id, p_render_hash: hash, p_finalize: true });
        continue;
      }
      const res = await discord.request("PATCH", `/channels/${t.channel_id}/messages/${t.message_id}`, message);
      if (res.ok) {
        report.edited++;
        await must(rpc, "bot_record_render", { p_guild_id: t.guild_id, p_event_id: row.event_id, p_render_hash: hash, p_finalize: finalize });
        continue;
      }
      const outcome = await noteFailure(res, { guild: t.guild_id, channel: t.channel_id, event: row.event_id });
      if (outcome === "rate" || outcome === "retry") retryAfter = Math.max(retryAfter, res.retryAfter ?? RETRY_SECONDS);
    }
    return retryAfter ? { retryAfter } : {};
  }

  // DMs ----------------------------------------------------------------------------------
  const dmChannels = new Map<string, string>(); // Discord user → DM channel, for this run

  async function sendDmBatch(batch: DmBatch) {
    const ids = batch.items.map((i) => i.id);
    const failed = async (res: DiscordResponse) => {
      const outcome = classify(res);
      if (res.global) globalStop = true;
      if (outcome === "undeliverable") {
        report.undeliverable++;
        await must(rpc, "bot_dm_undeliverable", { p_ids: ids, p_code: res.code });
      } else if (outcome === "rate" || outcome === "retry") {
        await must(rpc, "bot_retry_dm_batch", { p_ids: ids, p_retry_seconds: res.retryAfter ?? RETRY_SECONDS });
      } else {
        // Anything else won't get better by retrying (e.g. a bad request).
        report.failed++;
        console.error("DM failed", res.status, res.code, res.message);
        await must(rpc, "bot_retry_dm_batch", { p_ids: ids, p_retry_seconds: 0, p_drop_reason: `discord_${res.code ?? res.status}` });
      }
    };

    let channelId = dmChannels.get(batch.discord_id);
    if (!channelId) {
      const opened = await discord.request("POST", "/users/@me/channels", { recipient_id: batch.discord_id });
      if (!opened.ok) return failed(opened);
      channelId = (opened.body as { id: string }).id;
      dmChannels.set(batch.discord_id, channelId);
    }
    const sent = await discord.request("POST", `/channels/${channelId}/messages`, batchDms(batch, deps.appUrl));
    if (!sent.ok) return failed(sent);
    report.dms++;
    await must(rpc, "bot_complete_dm_batch", { p_ids: ids });
  }

  // The loop ------------------------------------------------------------------------------
  while (true) {
    if (globalStop) {
      report.stopped = "global_rate_limit";
      break;
    }
    if (Date.now() >= deps.deadline) {
      report.stopped = "deadline";
      break;
    }
    let did = 0;

    for (const post of await must<PostRow[]>(rpc, "bot_due_posts", { p_limit: 10 })) {
      if (globalStop) break;
      did++;
      await createPost(post);
    }

    for (const row of await must<OutboxRow[]>(rpc, "bot_claim_outbox", { p_limit: 20 })) {
      did++;
      if (globalStop) {
        await must(rpc, "bot_fail_outbox", { p_id: row.id, p_error: "global rate limit", p_retry_seconds: 5 });
        continue;
      }
      try {
        const result = await applyRow(row);
        if (result.retryAfter) {
          await must(rpc, "bot_fail_outbox", { p_id: row.id, p_error: "rate limited or Discord error", p_retry_seconds: result.retryAfter });
        } else {
          await must(rpc, "bot_complete_outbox", { p_ids: [row.id] });
        }
      } catch (e) {
        report.failed++;
        console.error("outbox row failed", row.id, e);
        await rpc("bot_fail_outbox", { p_id: row.id, p_error: String(e), p_retry_seconds: RETRY_SECONDS });
      }
    }

    if (!globalStop) {
      for (const batch of await must<DmBatch[]>(rpc, "bot_claim_dm_batches", { p_limit: 10 })) {
        did++;
        if (globalStop) {
          await must(rpc, "bot_retry_dm_batch", { p_ids: batch.items.map((i) => i.id), p_retry_seconds: 5 });
          continue;
        }
        try {
          await sendDmBatch(batch);
        } catch (e) {
          report.failed++;
          console.error("DM batch failed", e);
          await rpc("bot_retry_dm_batch", { p_ids: batch.items.map((i) => i.id), p_retry_seconds: RETRY_SECONDS });
        }
      }
    }

    if (!did) {
      const next = await must<number | null>(rpc, "bot_next_outbox_in", {});
      if (next === null || next > IDLE_WAIT_SECONDS || Date.now() + next * 1000 >= deps.deadline) break;
      await deps.sleep(Math.ceil(next * 1000) + 250);
    }
  }
  return report;
}
