import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  admin,
  closeDb,
  createTestUser,
  db,
  deleteTestUsers,
  linkDiscord,
  pauseDiscordWorker,
  resumeDiscordWorker,
  type TestUser,
} from "./helpers";

// ArmoryBot DMs (*_discord_dms.sql): per-player batches after the 2-minute
// window, the checks at send time, and recording the outcome.

const CARDS = [{ id: "test-dm-red", name: "DM Test Strike", pitch: 1, color: "Red", types: ["Generic"] }];

let owner: TestUser;
let requester: TestUser; // adds requests (the actor)
let fan: TestUser; // saved the store, Discord linked, DMs on
let fanDiscord: string;
let storeId: string;

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

type Batch = { user_id: string; discord_id: string; items: { id: number; kind: string; payload: Record<string, unknown>; event: { id: string; label: string; store: string } }[] };

async function oneOff(label: string) {
  return must(
    await owner.client.rpc("owner_create_event", { p_store_id: storeId, p_label: label, p_date: plusDays(today(), 2), p_start_time: "18:00" }),
    "create",
  );
}

/** The requester asks for a card on the event: queues a DM for the fan. */
async function request(eventId: string, quantity = 1) {
  await requester.client.rpc("attend_event", { p_event_id: eventId });
  must(await requester.client.rpc("add_requests", { p_event_id: eventId, p_items: [{ card_id: "test-dm-red", quantity }] }), "add");
}

/** Pretends the 2-minute batching window has passed. */
const windowPassed = () => db()`update public.discord_dm_queue set send_after = now() - interval '1 second' where user_id = ${fan.id} and sent_at is null`;
const claim = async () => must(await admin.rpc("bot_claim_dm_batches", { p_limit: 10, p_user_id: fan.id }), "claim") as Batch[];
const rows = async () => (await db()`select id, sent_at, dropped_reason, attempts from public.discord_dm_queue where user_id = ${fan.id} order by id`) as unknown as { id: number; sent_at: Date | null; dropped_reason: string | null; attempts: number }[];
const setDm = (enabled: boolean) =>
  fan.client.from("notification_preferences").upsert({ user_id: fan.id, kind: "new_requests", channel: "discord", enabled }, { onConflict: "user_id,kind,channel" });

beforeAll(async () => {
  await pauseDiscordWorker();
  await admin.from("cards").upsert(CARDS);
  [owner, requester, fan] = await Promise.all([
    createTestUser({ name: "DM Owner" }),
    createTestUser({ name: "DM Requester" }),
    createTestUser({ name: "DM Fan" }),
  ]);
  fanDiscord = await linkDiscord(fan.id);
  const { data: store } = await admin
    .from("stores")
    .insert({ name: "DM Test Store", city: "Dmville", country: "Testland", timezone: "UTC" })
    .select()
    .single();
  storeId = store!.id;
  await admin.from("store_owners").insert({ store_id: storeId, user_id: owner.id });
  await admin.from("user_stores").insert({ store_id: storeId, user_id: fan.id });
});

beforeEach(async () => {
  await setDm(true);
  await db()`delete from public.discord_dm_queue where user_id = ${fan.id}`;
  await db()`delete from public.discord_dm_status where user_id = ${fan.id}`;
});

afterAll(async () => {
  await admin.from("events").delete().eq("store_id", storeId);
  await admin.from("stores").delete().eq("id", storeId);
  await deleteTestUsers();
  await resumeDiscordWorker();
  await closeDb();
});

describe("batching", () => {
  it("waits for the 2-minute window, then hands out one batch per player", async () => {
    const eventId = await oneOff("Batch Armory");
    await request(eventId, 2);
    expect(await claim()).toEqual([]); // still inside the window

    await windowPassed();
    const [batch, ...others] = await claim();
    expect(others).toEqual([]);
    expect(batch).toMatchObject({ user_id: fan.id, discord_id: fanDiscord });
    expect(batch.items).toEqual([
      expect.objectContaining({
        kind: "new_requests",
        payload: expect.objectContaining({ actor: "DM Requester", copies: 2 }),
        event: expect.objectContaining({ id: eventId, label: "Batch Armory", store: "DM Test Store" }),
      }),
    ]);
    // Claimed: not handed out twice.
    expect(await claim()).toEqual([]);
  });

  it("includes the player's newer DMs in the same batch", async () => {
    const first = await oneOff("First Armory");
    const second = await oneOff("Second Armory");
    await request(first);
    await windowPassed();
    await request(second); // still inside its own window, but rides along
    const [batch] = await claim();
    expect(batch.items.map((i) => i.event.label).sort()).toEqual(["First Armory", "Second Armory"]);
  });

  it("claims nothing while the worker is paused, unless scoped (tests)", async () => {
    const eventId = await oneOff("Paused Armory");
    await request(eventId);
    await windowPassed();
    expect(must(await admin.rpc("bot_claim_dm_batches", { p_limit: 10 }), "unscoped")).toEqual([]);
    expect(await claim()).toHaveLength(1);
  });
});

describe("checks at send time", () => {
  it("drops DMs the player turned off since they were queued", async () => {
    await request(await oneOff("Off Armory"));
    await setDm(false);
    await windowPassed();
    expect(await claim()).toEqual([]);
    expect((await rows()).map((r) => r.dropped_reason)).toEqual(["turned_off"]);
  });

  it("drops DMs when the player disconnected Discord", async () => {
    await request(await oneOff("Unlinked Armory"));
    await db()`update public.discord_dm_queue set discord_id = '999999999999999999' where user_id = ${fan.id}`;
    await windowPassed();
    expect(await claim()).toEqual([]);
    expect((await rows()).map((r) => r.dropped_reason)).toEqual(["discord_disconnected"]);
  });

  it("drops DMs for events that were cancelled meanwhile", async () => {
    const eventId = await oneOff("Cancelled Armory");
    await request(eventId);
    ok(await owner.client.rpc("owner_cancel_event", { p_event_id: eventId }), "cancel");
    await windowPassed();
    expect(await claim()).toEqual([]);
    expect((await rows()).map((r) => r.dropped_reason)).toEqual(["event_over"]);
  });

  it("gives up after 5 attempts", async () => {
    await request(await oneOff("Retry Armory"));
    await db()`update public.discord_dm_queue set attempts = 5 where user_id = ${fan.id}`;
    await windowPassed();
    expect(await claim()).toEqual([]);
    expect((await rows()).map((r) => r.dropped_reason)).toEqual(["gave_up"]);
  });
});

describe("outcomes", () => {
  it("sent: marks the rows and clears a 'can't DM you' status", async () => {
    await request(await oneOff("Sent Armory"));
    await windowPassed();
    const [batch] = await claim();
    await db()`insert into public.discord_dm_status (user_id, undeliverable_at, error_code) values (${fan.id}, now() - interval '2 days', 50007)`;
    ok(await admin.rpc("bot_complete_dm_batch", { p_ids: batch.items.map((i) => i.id) }), "complete");
    expect((await rows())[0].sent_at).not.toBeNull();
    expect(await db()`select 1 from public.discord_dm_status where user_id = ${fan.id}`).toHaveLength(0);
  });

  it("undeliverable: drops the rows, records why, and pauses new DMs for a day", async () => {
    const eventId = await oneOff("Blocked Armory");
    await request(eventId);
    await windowPassed();
    const [batch] = await claim();
    ok(await admin.rpc("bot_dm_undeliverable", { p_ids: batch.items.map((i) => i.id), p_code: 50278 }), "undeliverable");
    expect((await rows()).map((r) => r.dropped_reason)).toEqual(["discord_50278"]);
    // The player sees why on their settings page (RLS: their own row).
    expect((await fan.client.from("discord_dm_status").select("error_code")).data).toEqual([{ error_code: 50278 }]);
    // New announcements don't queue DMs while paused (notify() checks).
    await request(eventId, 3);
    expect(await rows()).toHaveLength(1);
  });

  it("retry: stays claimed until the retry time; drop: never sent", async () => {
    await request(await oneOff("Later Armory"));
    await windowPassed();
    const [batch] = await claim();
    const ids = batch.items.map((i) => i.id);
    ok(await admin.rpc("bot_retry_dm_batch", { p_ids: ids, p_retry_seconds: 60 }), "retry");
    expect(await claim()).toEqual([]);
    await db()`update public.discord_dm_queue set claimed_until = now() - interval '1 second' where id = any(${ids})`;
    const [again] = await claim();
    expect(again.items.map((i) => i.id)).toEqual(ids);
    expect((await rows())[0].attempts).toBe(2);

    ok(await admin.rpc("bot_retry_dm_batch", { p_ids: ids, p_retry_seconds: 0, p_drop_reason: "discord_50035" }), "drop");
    expect((await rows()).map((r) => r.dropped_reason)).toEqual(["discord_50035"]);
  });
});
