import { expect, test, uid } from "../support/fixtures";
import { E2E_STORE_ID } from "../support/env";
import { discordSnowflake } from "../support/identities";
import { admin, currentEventId } from "../support/supabase";
import { openEvent } from "../support/ui";

// ArmoryBot's Going button works without an ArmoryPal account (docs/armorybot.md,
// "Discord guests"). Discord can't run in CI, so the tap is the bot's RPC.

test("a Discord guest appears live on the Going tab, marked via Discord, and counts as going", async ({ newPlayer }) => {
  const { page, db } = await newPlayer();
  const eventId = await currentEventId(db, E2E_STORE_ID);
  await openEvent(page, eventId, "going");
  const goingTab = page.getByRole("link", { name: /^Going \(\d+\)$/ });
  const before = Number((await goingTab.textContent())!.match(/\d+/)![0]);

  const name = `Zoe ${uid()}`;
  const discordId = discordSnowflake();
  const { data, error } = await admin().rpc("bot_attend", { p_discord_id: discordId, p_event_id: eventId, p_display_name: name });
  expect(error).toBeNull();
  expect(data).toBe("guest");

  try {
    const row = page.getByRole("listitem").filter({ hasText: name });
    await expect(row).toBeVisible(); // live, via the event topic
    await expect(row).toContainText("via Discord");
    await expect(goingTab).toHaveText(`Going (${before + 1})`);
  } finally {
    await admin().rpc("bot_guest_leave", { p_discord_id: discordId, p_event_id: eventId });
  }
  await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
});
