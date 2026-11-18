import { describe, expect, it } from "vitest";
import type { Rpc } from "./db.ts";
import { buttonId } from "./custom-id.ts";
import { EPHEMERAL, InteractionType, ResponseType, type Interaction, type InteractionResponse, type MessageData } from "./discord-types.ts";
import { deferredResponseFor, followUpBody, handleInteraction, requestsEmbed } from "./interactions.ts";

const APP = "https://armorypal.test";
const EVENT = "7afd6814-aa2c-490d-a17c-3dac4b852563";
const STORE = "00000000-0000-4000-a000-0000000e2e01";
const NOW = new Date("2026-11-18T12:00:00Z");

type Call = { name: string; args: Record<string, unknown> };

/** A fake database: answers per RPC name, records the calls. */
function fakeRpc(answers: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>) {
  const calls: Call[] = [];
  const rpc: Rpc = async (name, args) => {
    calls.push({ name, args });
    const a = answers[name];
    const value = typeof a === "function" ? (a as (x: Record<string, unknown>) => unknown)(args) : a;
    if (value instanceof Error) return { data: null, error: { code: "P0001", message: value.message } };
    return { data: (value ?? null) as never, error: null };
  };
  return { rpc, calls };
}

const run = (i: Partial<Interaction>, answers: Parameters<typeof fakeRpc>[0] = {}) => {
  const db = fakeRpc(answers);
  const interaction = { id: "1", application_id: "app", token: "tok", ...i } as Interaction;
  return handleInteraction(interaction, { rpc: db.rpc, appUrl: APP, now: () => NOW }).then((res) => ({ res, calls: db.calls }));
};

const data = (res: InteractionResponse) => (res as { data: MessageData }).data;

const command = (sub: string, options: { name: string; type: number; value: string | number; focused?: boolean }[] = [], extra: Partial<Interaction> = {}) => ({
  type: InteractionType.APPLICATION_COMMAND,
  guild_id: "111",
  channel_id: "222",
  member: { user: { id: "999" }, permissions: "0" },
  app_permissions: String((1n << 10n) | (1n << 11n) | (1n << 14n)),
  data: { name: "armory", options: [{ type: 1, name: sub, options }] },
  ...extra,
});

const click = (action: Parameters<typeof buttonId>[0]) => ({
  type: InteractionType.MESSAGE_COMPONENT,
  guild_id: "111",
  channel_id: "222",
  member: { user: { id: "999" } },
  data: { custom_id: buttonId(action, EVENT) },
});

const statusRow = {
  store_id: STORE,
  store: "Uncommons",
  channel_id: "222",
  days_before: 2,
  post_time: "10:00",
  broken_at: null,
  broken_reason: null,
  next_post: { event_id: EVENT, label: "Thursday Armory", starts_at: "2026-11-19T23:00:00Z", post_at: "2026-11-17T15:00:00Z" },
};

describe("every reply", () => {
  it("answers Discord's PING", async () => {
    expect((await run({ type: InteractionType.PING })).res).toEqual({ type: ResponseType.PONG });
  });

  it("is ephemeral and never mentions anyone", async () => {
    const { res } = await run(command("status"), { bot_status: [statusRow] });
    expect(data(res).flags).toBe(EPHEMERAL);
    expect(data(res).allowed_mentions).toEqual({ parse: [] });
  });
});

describe("/armory link-store", () => {
  it("links with the invoker's Discord ID, the server and this channel", async () => {
    const { res, calls } = await run(command("link-store", [{ name: "store", type: 3, value: STORE }]), {
      bot_link_store: { store_id: STORE },
      bot_status: [statusRow],
    });
    expect(calls[0]).toEqual({
      name: "bot_link_store",
      args: { p_discord_id: "999", p_guild_id: "111", p_channel_id: "222", p_store_id: STORE },
    });
    expect(data(res).content).toContain("Linked! **Uncommons** → <#222> · posted 2 days before, at 10:00 store time");
    expect(data(res).content).toContain("posted within a minute"); // post_at is already past
    expect(data(res).content).not.toContain("Make sure ArmoryBot can view");
  });

  it("warns when the bot may not be able to post in the chosen channel", async () => {
    const { res, calls } = await run(
      command("link-store", [
        { name: "store", type: 3, value: STORE },
        { name: "channel", type: 7, value: "333" },
      ]),
      { bot_link_store: { store_id: STORE }, bot_status: [] },
    );
    expect(calls[0].args.p_channel_id).toBe("333");
    expect(data(res).content).toContain("Make sure ArmoryBot can view <#333>");
  });

  it("asks for a store from the list when the value isn't one", async () => {
    const { res, calls } = await run(command("link-store", [{ name: "store", type: 3, value: "uncommons" }]));
    expect(calls).toEqual([]);
    expect(data(res).content).toBe("Pick a store from the list as you type its name.");
  });

  it("explains a refused link", async () => {
    const { res } = await run(command("link-store", [{ name: "store", type: 3, value: STORE }]), {
      bot_link_store: new Error("not_store_owner"),
    });
    expect(data(res).content).toBe("Only this store's owners (or ArmoryPal admins) can do that.");
  });

  it("offers to connect Discord when the invoker isn't linked", async () => {
    const { res } = await run(command("link-store", [{ name: "store", type: 3, value: STORE }]), {
      bot_link_store: new Error("discord_not_linked"),
    });
    expect(data(res).content).toMatch(/^Connect your Discord to ArmoryPal/);
    expect(data(res).components?.[0].components[0]).toMatchObject({ style: 5, url: `${APP}/me#connected-accounts` });
  });
});

describe("/armory settings, unlink, status", () => {
  it("validates the post time before calling the database", async () => {
    const { res, calls } = await run(command("settings", [{ name: "post_time", type: 3, value: "7pm" }]));
    expect(calls).toEqual([]);
    expect(data(res).content).toMatch(/24-hour time/);
  });

  it("sends only the settings that were given", async () => {
    const { res, calls } = await run(
      command("settings", [
        { name: "days_before", type: 4, value: 0 },
        { name: "post_time", type: 3, value: "9:30" },
      ]),
      { bot_update_settings: { store_id: STORE }, bot_status: [{ ...statusRow, days_before: 0, post_time: "09:30" }] },
    );
    expect(calls[0].args).toEqual({ p_discord_id: "999", p_guild_id: "111", p_days_before: 0, p_post_time: "09:30" });
    expect(data(res).content).toMatch(/^Saved\.\n\*\*Uncommons\*\* → <#222> · posted on the day, at 09:30/);
  });

  it("unlink passes Manage Server from the member's permissions", async () => {
    const manage = command("unlink", [], { member: { user: { id: "999" }, permissions: String(1n << 5n) } });
    const { res, calls } = await run(manage, { bot_status: [statusRow], bot_unlink_store: STORE });
    expect(calls[1]).toEqual({
      name: "bot_unlink_store",
      args: { p_discord_id: "999", p_guild_id: "111", p_store_id: null, p_has_manage_guild: true },
    });
    expect(data(res).content).toMatch(/^Unlinked \*\*Uncommons\*\*/);

    const plain = await run(command("unlink"), { bot_status: [], bot_unlink_store: new Error("not_store_owner") });
    expect(plain.calls[1].args.p_has_manage_guild).toBe(false);
  });

  it("status explains a broken channel and an empty server", async () => {
    const broken = await run(command("status"), {
      bot_status: [{ ...statusRow, broken_at: NOW.toISOString(), broken_reason: "Missing Access" }],
    });
    expect(data(broken.res).content).toContain("⚠️ ArmoryBot can't post there (Missing Access)");
    const empty = await run(command("status"), { bot_status: [] });
    expect(data(empty.res).content).toMatch(/^No stores are linked/);
  });

  it("refuses outside a server", async () => {
    const { res } = await run(command("status", [], { guild_id: undefined }));
    expect(data(res).content).toBe("Use this command in a server.");
  });
});

describe("autocomplete", () => {
  it("searches stores for link-store", async () => {
    const i = {
      ...command("link-store", [{ name: "store", type: 3, value: "unc", focused: true }]),
      type: InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE,
    };
    const { res, calls } = await run(i, { bot_search_stores: [{ id: STORE, name: "Uncommons", city: "New York", region: "NY" }] });
    expect(calls[0]).toEqual({ name: "bot_search_stores", args: { p_query: "unc" } });
    expect(res).toEqual({
      type: ResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
      data: { choices: [{ name: "Uncommons · New York, NY", value: STORE }] },
    });
  });

  it("offers only this server's linked stores for unlink", async () => {
    const i = {
      ...command("unlink", [{ name: "store", type: 3, value: "zzz", focused: true }]),
      type: InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE,
    };
    const { res } = await run(i, { bot_status: [statusRow] });
    expect(res).toEqual({ type: ResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices: [] } });
  });

  it("returns no choices when the database fails", async () => {
    const i = {
      ...command("link-store", [{ name: "store", type: 3, value: "unc", focused: true }]),
      type: InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE,
    };
    const { res } = await run(i, { bot_search_stores: new Error("boom") });
    expect(res).toEqual({ type: ResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices: [] } });
  });
});

describe("buttons", () => {
  const request = (over: object) => ({
    id: "r",
    card: "Snatch",
    pitch: 1,
    quantity: 2,
    pledged: 0,
    my_pledge: 0,
    requester: "Alice",
    is_mine: false,
    ...over,
  });

  it("Going attends as the clicker", async () => {
    const { res, calls } = await run(click("going"), { bot_attend: null });
    expect(calls).toEqual([{ name: "bot_attend", args: { p_discord_id: "999", p_event_id: EVENT } }]);
    expect(data(res).content).toMatch(/^You're going!/);
  });

  it("Going shows the app's rule when the event is over or cancelled", async () => {
    const { res } = await run(click("going"), { bot_attend: new Error("event_cancelled") });
    expect(data(res).content).toBe("This event was cancelled.");
  });

  it("unlinked players get the Connect Discord reply", async () => {
    const { res } = await run(click("going"), { bot_attend: new Error("discord_not_linked") });
    expect(data(res).components?.[0].components[0]).toMatchObject({ label: "Connect Discord", url: `${APP}/me#connected-accounts` });
  });

  it("Not going with requests asks whether to cancel them, like the app", async () => {
    const { res } = await run(click("leave"), {
      bot_event_requests: { attending: true, requests: [request({ is_mine: true }), request({ my_pledge: 1 })] },
    });
    expect(data(res).content).toContain("The 1 card you offered to bring will be needed again.");
    expect(data(res).components?.[0].components.map((b) => [b.label, b.custom_id])).toEqual([
      ["Leave and cancel my requests", buttonId("leave-cancel", EVENT)],
      ["Leave, keep my requests", buttonId("leave-keep", EVENT)],
    ]);
  });

  it("Not going without requests offers a single Leave", async () => {
    const { res } = await run(click("leave"), { bot_event_requests: { attending: true, requests: [] } });
    expect(data(res).components?.[0].components.map((b) => b.label)).toEqual(["Leave"]);
  });

  it("Not going when not going says so", async () => {
    const { res } = await run(click("leave"), { bot_event_requests: { attending: false, requests: [] } });
    expect(data(res).content).toBe("You're not on the Going list.");
  });

  it("the leave buttons leave and replace the prompt", async () => {
    const cancel = await run(click("leave-cancel"), { bot_leave: null });
    expect(cancel.calls[0].args).toEqual({ p_discord_id: "999", p_event_id: EVENT, p_cancel_requests: true });
    expect(cancel.res).toMatchObject({ type: ResponseType.UPDATE_MESSAGE, data: { components: [] } });
    const keep = await run(click("leave-keep"), { bot_leave: null });
    expect(keep.calls[0].args.p_cancel_requests).toBe(false);
    const ended = await run(click("leave-keep"), { bot_leave: new Error("event_ended") });
    expect(ended.res).toMatchObject({ type: ResponseType.UPDATE_MESSAGE, data: { content: "This event has already ended." } });
  });

  it("Requests lists what's still needed, others' first", async () => {
    const { res } = await run(click("requests"), {
      bot_event_requests: {
        attending: true,
        requests: [
          request({ card: "Mine", is_mine: true, requester: "Me" }),
          request({ card: "Covered", pledged: 2 }),
          request({ card: "Sink Below", pitch: 3, quantity: 3, pledged: 1, my_pledge: 1, requester: "Bob" }),
        ],
      },
    });
    expect(data(res).embeds?.[0]).toMatchObject({
      title: "Open requests (2)",
      description: "🔵 2× Sink Below · Bob · you're bringing 1\n🔴 2× Mine · you",
    });
    expect(data(res).components?.[0].components[0].url).toBe(`${APP}/events/${EVENT}?tab=requests`);
  });

  it("rejects crafted button ids without touching the database", async () => {
    const { res, calls } = await run({ ...click("going"), data: { custom_id: "ap:admin_ban:x" } });
    expect(calls).toEqual([]);
    expect(data(res).content).toBe("That button doesn't work anymore.");
  });
});

describe("requestsEmbed", () => {
  it("escapes names and shortens long lists with a link", () => {
    const rows = Array.from({ length: 200 }, (_, n) => ({
      id: String(n),
      card: `Card **${n}** with a long name to fill the embed quickly`,
      pitch: 2,
      quantity: 3,
      pledged: 0,
      my_pledge: 0,
      requester: "Someone",
      is_mine: false,
    }));
    const embed = requestsEmbed(rows, `${APP}/x`);
    expect(embed.description!.length).toBeLessThanOrEqual(4096);
    expect(embed.description).toContain("\\*\\*0\\*\\*");
    expect(embed.description).toMatch(/\+\d+ more in \[ArmoryPal\]\(https:\/\/armorypal\.test\/x\)$/);
  });
});

describe("deferring", () => {
  it("defers commands and replies as ephemeral thinking, leave buttons as message updates", () => {
    expect(deferredResponseFor(command("status") as Interaction)).toEqual({ type: 5, data: { flags: EPHEMERAL } });
    expect(deferredResponseFor(click("going") as Interaction)).toEqual({ type: 5, data: { flags: EPHEMERAL } });
    expect(deferredResponseFor(click("leave-keep") as Interaction)).toEqual({ type: 6 });
    expect(deferredResponseFor({ type: InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE } as Interaction)).toBeNull();
  });

  it("turns a finished reply into the follow-up body", async () => {
    const { res } = await run(click("going"), { bot_attend: null });
    const body = followUpBody(res);
    expect(body.flags).toBeUndefined();
    expect(body.content).toMatch(/^You're going!/);
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });
});
