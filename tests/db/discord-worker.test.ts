import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, closeDb, pauseDiscordWorker, resumeDiscordWorker, createTestUser, db, deleteTestUsers, snowflake, type TestUser } from "./helpers";

// ArmoryBot worker SQL (*_discord_worker.sql): which posts are due, claims,
// post bookkeeping, broken links, reconcile, and waking the worker.

let owner: TestUser;
let storeId: string;
const guild = snowflake();
const channel = snowflake();

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error || res.data === null) throw new Error(`${what}: ${res.error?.message ?? "no data"}`);
  return res.data;
}
function ok(res: { error: { message: string } | null }, what: string) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
}

/** A one-off event `days` from today at 18:00 UTC. */
async function oneOff(days: number, label = "Worker Armory") {
  return must(
    await owner.client.rpc("owner_create_event", { p_store_id: storeId, p_label: label, p_date: plusDays(today(), days), p_start_time: "18:00" }),
    "create",
  );
}

const link = (over: Record<string, unknown> = {}) =>
  admin.from("discord_guild_stores").upsert({ guild_id: guild, store_id: storeId, channel_id: channel, days_before: 2, post_time: "00:00", ...over });

// Only this test's server: bot_due_posts claims what it returns, so never touch real links.
const due = async () => must(await admin.rpc("bot_due_posts", { p_limit: 50, p_guild_id: guild }), "due");

beforeAll(async () => {
  await pauseDiscordWorker();
  owner = await createTestUser({ name: "Worker Owner" });
  const { data: store } = await admin
    .from("stores")
    .insert({ name: "Worker Test Store", city: "Workville", country: "Testland", timezone: "UTC" })
    .select()
    .single();
  storeId = store!.id;
  await admin.from("store_owners").insert({ store_id: storeId, user_id: owner.id });
});

afterAll(async () => {
  await admin.from("discord_event_posts").delete().eq("guild_id", guild);
  await admin.from("discord_guild_stores").delete().eq("guild_id", guild);
  const { data: events } = await admin.from("events").select("id").eq("store_id", storeId);
  await admin.from("discord_outbox").delete().in("event_id", (events ?? []).map((e) => e.id));
  await admin.from("events").delete().eq("store_id", storeId);
  await admin.from("stores").delete().eq("id", storeId);
  await deleteTestUsers();
  await resumeDiscordWorker();
  await closeDb();
});

describe("bot_due_posts", () => {
  it("claims events inside the window once, and leaves later ones", async () => {
    await link({ days_before: 2 });
    const soon = await oneOff(1, "Soon"); // inside "2 days before"
    const later = await oneOff(5, "Later"); // not yet

    const first = await due();
    expect(first.map((p) => p.event_id)).toContain(soon);
    expect(first.map((p) => p.event_id)).not.toContain(later);
    expect(first.find((p) => p.event_id === soon)).toMatchObject({ channel_id: channel, message_id: null });
    // Claimed: not handed out again.
    expect((await due()).map((p) => p.event_id)).not.toContain(soon);
  });

  it("hands out claims the worker never finished after 5 minutes", async () => {
    const eventId = await oneOff(1, "Stale");
    await due();
    await db()`update public.discord_event_posts set created_at = now() - interval '6 minutes' where event_id = ${eventId}`;
    expect((await due()).map((p) => p.event_id)).toContain(eventId);
  });

  it("skips broken links and deleted events", async () => {
    const eventId = await oneOff(1, "Broken");
    await link({ broken_at: new Date().toISOString(), broken_reason: "x" });
    expect((await due()).map((p) => p.event_id)).not.toContain(eventId);
    await link({ broken_at: null, broken_reason: null });

    const deleted = await oneOff(1, "Deleted");
    ok(await owner.client.rpc("owner_delete_event", { p_event_id: deleted }), "delete");
    expect((await due()).map((p) => p.event_id)).not.toContain(deleted);
  });

  it("respects the store-local post time", async () => {
    const eventId = await oneOff(2, "Timed");
    await link({ days_before: 2, post_time: "23:59" }); // today at 23:59 UTC: not yet (unless it's 23:59 now)
    if (new Date().getUTCHours() * 60 + new Date().getUTCMinutes() < 23 * 60 + 59) {
      expect((await due()).map((p) => p.event_id)).not.toContain(eventId);
    }
    await link({ days_before: 2, post_time: "00:00" });
    expect((await due()).map((p) => p.event_id)).toContain(eventId);
  });
});

describe("post bookkeeping", () => {
  it("records the message, lists targets, finalizes and marks gone", async () => {
    await link();
    const eventId = await oneOff(1, "Book");
    await due();
    const message = snowflake();
    expect(must(await admin.rpc("bot_record_post", { p_guild_id: guild, p_event_id: eventId, p_message_id: message, p_render_hash: "h1" }), "record")).toBe(true);

    expect(must(await admin.rpc("bot_post_targets", { p_event_id: eventId }), "targets")).toEqual([
      { guild_id: guild, channel_id: channel, message_id: message, render_hash: "h1", linked: true, broken: false },
    ]);

    ok(await admin.rpc("bot_record_render", { p_guild_id: guild, p_event_id: eventId, p_render_hash: "h2", p_finalize: true }), "finalize");
    expect(must(await admin.rpc("bot_post_targets", { p_event_id: eventId }), "targets")).toEqual([]);
    const { data: row } = await admin.from("discord_event_posts").select("render_hash, finalized_at").eq("event_id", eventId).single();
    expect(row!.render_hash).toBe("h2");
    expect(row!.finalized_at).not.toBeNull();
  });

  it("tells the worker when the event was deleted while posting", async () => {
    await link();
    const eventId = await oneOff(1, "Race");
    await due();
    ok(await owner.client.rpc("owner_delete_event", { p_event_id: eventId }), "delete");
    expect(must(await admin.rpc("bot_record_post", { p_guild_id: guild, p_event_id: eventId, p_message_id: snowflake(), p_render_hash: "h" }), "record")).toBe(false);
  });

  it("releases a failed claim and marks the channel broken", async () => {
    await link();
    const eventId = await oneOff(1, "Release");
    await due();
    ok(await admin.rpc("bot_release_post", { p_guild_id: guild, p_event_id: eventId }), "release");
    expect((await admin.from("discord_event_posts").select("event_id").eq("event_id", eventId)).data).toEqual([]);

    ok(await admin.rpc("bot_mark_broken", { p_guild_id: guild, p_channel_id: channel, p_reason: "the bot can't see the channel" }), "broken");
    const { data: l } = await admin.from("discord_guild_stores").select("broken_at, broken_reason").eq("guild_id", guild).single();
    expect(l!.broken_reason).toBe("the bot can't see the channel");
    // Picking the channel again with /armory settings clears it.
    const ownerDiscord = snowflake();
    await db()`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
      values (${ownerDiscord}, ${owner.id}, ${db().json({ sub: ownerDiscord })}, 'discord', now(), now())`;
    ok(await admin.rpc("bot_update_settings", { p_discord_id: ownerDiscord, p_guild_id: guild, p_channel_id: channel }), "settings");
    expect((await admin.from("discord_guild_stores").select("broken_at").eq("guild_id", guild).single()).data!.broken_at).toBeNull();
  });

  it("reports when the next debounced outbox row is due", async () => {
    await link();
    const eventId = await oneOff(1, "Next");
    await due();
    ok(await admin.rpc("bot_record_post", { p_guild_id: guild, p_event_id: eventId, p_message_id: snowflake(), p_render_hash: "h" }), "record");
    await owner.client.rpc("attend_event", { p_event_id: eventId }); // queues a refresh ~2 s out
    // Paused (by these tests): the worker sees nothing to wait for.
    expect((await admin.rpc("bot_next_outbox_in", {})).data).toBeNull();
    // Unpaused, inside a rolled-back transaction so a running local worker never sees it.
    let next: number | null = null;
    await db()
      .begin(async (tx) => {
        await tx`update public.discord_worker_state set paused_until = null where id = 1`;
        const [row] = await tx`select public.bot_next_outbox_in()::float8 as n`;
        next = row.n;
        throw new Error("rollback");
      })
      .catch((e) => {
        if (e.message !== "rollback") throw e;
      });
    expect(next).not.toBeNull();
    expect(next!).toBeLessThanOrEqual(2.5);
  });

  it("reconcile queues a refresh for every live post", async () => {
    await link();
    const eventId = await oneOff(1, "Reconcile");
    await due();
    ok(await admin.rpc("bot_record_post", { p_guild_id: guild, p_event_id: eventId, p_message_id: snowflake(), p_render_hash: "h" }), "record");
    await admin.from("discord_outbox").delete().eq("event_id", eventId);
    ok(await admin.rpc("queue_discord_reconcile", {}), "reconcile");
    const { data } = await admin.from("discord_outbox").select("kind").eq("event_id", eventId).is("processed_at", null);
    expect(data).toEqual([{ kind: "refresh" }]);
  });
});

describe("waking the worker", () => {
  const url = "http://worker.invalid/functions/v1/discord-worker";
  /**
   * Runs fn in a transaction that's rolled back, so pg_net never sends anything.
   * A developer's real local worker secrets are set aside inside the same
   * transaction (never committed, invisible to other sessions).
   */
  async function inRollback<T>(fn: (tx: ReturnType<typeof db>) => Promise<T>): Promise<T> {
    let result: T;
    await db()
      .begin(async (tx) => {
        await tx`select vault.update_secret(id, null, name || '_set_aside_by_test')
                 from vault.secrets where name in ('discord_worker_url', 'discord_worker_secret')`;
        result = await fn(tx as unknown as ReturnType<typeof db>);
        throw new Error("rollback");
      })
      .catch((e) => {
        if (e.message !== "rollback") throw e;
      });
    return result!;
  }

  it("does nothing while paused", async () => {
    const queued = await inRollback(async (tx) => {
      await tx`select public.kick_discord_worker(false)`;
      return tx`select url from net.http_request_queue where url = ${url}`;
    });
    expect(queued).toHaveLength(0);
    expect(must(await admin.rpc("bot_claim_outbox", { p_limit: 5 }), "claim")).toEqual([]);
  });

  it("does nothing without the Vault secrets", async () => {
    const queued = await inRollback(async (tx) => {
      await tx`update public.discord_worker_state set paused_until = null`;
      await tx`select public.kick_discord_worker(false)`;
      return tx`select url from net.http_request_queue where url = ${url}`;
    });
    expect(queued).toHaveLength(0);
  });

  it("posts to the worker URL with the shared secret, throttled for outbox kicks", async () => {
    const queued = await inRollback(async (tx) => {
      await tx`select vault.create_secret(${url}, 'discord_worker_url')`;
      await tx`select vault.create_secret('s3cret-s3cret-s3cret-s3cret-s3cret', 'discord_worker_secret')`;
      await tx`update public.discord_worker_state set last_kick_at = '-infinity', paused_until = null`;
      await tx`select public.kick_discord_worker(true)`;
      await tx`select public.kick_discord_worker(true)`; // within 2 s: skipped
      await tx`select public.kick_discord_worker(false)`; // cron: never throttled
      return tx`select method, headers from net.http_request_queue where url = ${url}`;
    });
    expect(queued).toHaveLength(2);
    expect(queued[0].method).toBe("POST");
    expect(queued[0].headers).toMatchObject({ Authorization: "Bearer s3cret-s3cret-s3cret-s3cret-s3cret" });
  });

  it("a broken worker URL never makes a player's write fail", async () => {
    await inRollback(async (tx) => {
      await tx`update public.discord_worker_state set last_kick_at = '-infinity', paused_until = null`;
      await tx`select vault.create_secret('not a url', 'discord_worker_url')`;
      await tx`select vault.create_secret('s3cret-s3cret-s3cret-s3cret-s3cret', 'discord_worker_secret')`;
      // Both the cron path and the outbox trigger path return normally (a warning is logged).
      await tx`select public.kick_discord_worker(false)`;
      await tx`select public.kick_discord_worker(true)`;
    });
  });

  it("strips pasted line breaks from the worker URL", async () => {
    const queued = await inRollback(async (tx) => {
      await tx`update public.discord_worker_state set paused_until = null`;
      const pasted = `http://worker.invalid/functions/v1/${String.fromCharCode(13, 10)}  discord-worker`;
      await tx`select vault.create_secret(${pasted}, 'discord_worker_url')`;
      await tx`select vault.create_secret('s3cret-s3cret-s3cret-s3cret-s3cret', 'discord_worker_secret')`;
      await tx`select public.kick_discord_worker(false)`;
      return tx`select url from net.http_request_queue where url = ${url}`;
    });
    expect(queued).toHaveLength(1);
  });

  it("runs every minute, and reconciles every 10 minutes", async () => {
    const jobs = await db()`select jobname, schedule, command from cron.job where jobname in ('discord-worker', 'discord-reconcile') order by jobname`;
    expect(jobs.map((j) => [j.jobname, j.schedule])).toEqual([
      ["discord-reconcile", "*/10 * * * *"],
      ["discord-worker", "* * * * *"],
    ]);
  });
});
