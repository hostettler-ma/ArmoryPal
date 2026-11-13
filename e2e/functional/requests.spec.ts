import { expect, test, uid } from "../support/fixtures";
import { CARDS, E2E_STORE_ID } from "../support/env";
import { admin, currentEventId } from "../support/supabase";
import { attend, clickTab, openEvent, pickCard, requestRow, setQuantity, sheet } from "../support/ui";

const RED = `${CARDS.snatch} (Red)`;
const YELLOW = `${CARDS.snatch} (Yellow)`;
const BLUE = `${CARDS.snatch} (Blue)`;

/**
 * The core loop, with two players in two browsers at once:
 * attend → request → the other side sees it live → pledge → coverage
 * updates live → notifications → leave → cancel.
 */
test("two players request and bring cards, with live updates on both screens", async ({ newPlayer }) => {
  const alice = await newPlayer({ name: `Alice ${uid()}` });
  const bob = await newPlayer({ name: `Bob ${uid()}` });
  const eventId = await currentEventId(alice.db, E2E_STORE_ID);

  // --- Both say they're going -----------------------------------------------
  await openEvent(alice.page, eventId);
  await expect(alice.page.getByRole("link", { name: /Going \(\d+\)/ })).toHaveAttribute("aria-current", "page");
  await attend(alice.page);
  await expect(alice.page.locator("li", { hasText: alice.name }).filter({ hasText: "(you)" })).toBeVisible();

  await openEvent(bob.page, eventId, "requests");
  await expect(bob.page.getByText("Mark yourself as going to request cards")).toBeVisible();
  await attend(bob.page);
  // Alice's Going list picks Bob up without a reload.
  await expect(alice.page.getByText(bob.name)).toBeVisible();

  // --- Alice requests 3× red + 1× blue ---------------------------------------
  await clickTab(alice.page, /Requests/);
  await alice.page.getByRole("button", { name: "+ Request cards" }).click();
  const add = sheet(alice.page, "Request cards");
  await expect(add).toBeVisible();
  await expect(add.getByRole("button", { name: /^Request/ })).toBeDisabled(); // nothing picked yet

  await add.getByRole("combobox").fill("qqqq no card");
  await expect(add.getByText("No cards match.")).toBeVisible();
  await pickCard(add, CARDS.snatch, ["Red", "Blue"]);
  await setQuantity(add, `How many ${RED}`, 3);
  await add.getByLabel(/Note/).fill("x".repeat(250));
  await expect(add.getByLabel(/Note/)).toHaveValue("x".repeat(200)); // capped at 200
  await add.getByLabel(/Note/).fill("any printing is fine");
  await add.getByRole("button", { name: "Request 4 cards" }).click();
  await expect(add).toBeHidden();

  await expect(requestRow(alice.page, RED)).toContainText("Need 3");
  await expect(requestRow(alice.page, RED)).toContainText("Your request");
  await expect(requestRow(alice.page, RED)).toContainText("any printing is fine");
  await expect(requestRow(alice.page, BLUE)).toContainText("Need 1");
  // You can't bring your own card.
  await expect(requestRow(alice.page, RED).getByRole("button", { name: "I'll bring it" })).toHaveCount(0);

  // Bob's open page shows the new requests live, and his bell lights up.
  await expect(requestRow(bob.page, RED, alice.name)).toContainText("Need 3");
  await expect(bob.page.getByRole("link", { name: /Notifications, \d+ unread/ })).toBeVisible();

  // --- Bob brings 2 of the 3 red -------------------------------------------------
  await requestRow(bob.page, RED, alice.name).getByRole("button", { name: "I'll bring it" }).click();
  const bring = sheet(bob.page, "Bring this card");
  await expect(bring).toContainText(`for ${alice.name} · needs 3`);
  await expect(bring).toContainText("any printing is fine");
  await expect(bring.getByText("WTR · ARC")).toBeVisible();
  // Can't promise more than is still needed.
  await setQuantity(bring, "How many will you bring", 3);
  await expect(bring.getByRole("button", { name: "More" })).toBeDisabled();
  await setQuantity(bring, "How many will you bring", 2);
  await bring.getByRole("button", { name: "I'll bring 2" }).click();
  await expect(bring).toBeHidden();
  await expect(requestRow(bob.page, RED, alice.name)).toContainText("2 of 3 coming");
  await expect(requestRow(bob.page, RED, alice.name).getByRole("button", { name: "Bringing 2" })).toBeVisible();

  // Alice sees it live.
  await expect(requestRow(alice.page, RED)).toContainText("2 of 3 coming");

  // --- Checklists --------------------------------------------------------------------
  await clickTab(bob.page, /My checklist/);
  await expect(bob.page.getByText(`2× ${RED}`)).toBeVisible();
  await expect(bob.page.getByText(`for ${alice.name}`)).toBeVisible();

  await clickTab(alice.page, /My checklist/);
  await expect(requestRow(alice.page, RED)).toContainText(`${bob.name} ×2`);
  await expect(requestRow(alice.page, BLUE)).toContainText("Nobody is bringing this yet.");

  // Alice can't lower her request below what's pledged.
  await requestRow(alice.page, RED).getByRole("button", { name: "Edit" }).click();
  const edit = sheet(alice.page, "Edit request");
  await expect(edit.getByText("2 already pledged, so you can't go below that.")).toBeVisible();
  await setQuantity(edit, "How many do you need", 2);
  await expect(edit.getByRole("group", { name: "How many do you need" }).getByRole("button", { name: "Fewer" })).toBeDisabled();
  await edit.getByLabel("Note").fill("foil preferred");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  await expect(requestRow(alice.page, RED)).toContainText("Covered · 2");
  await expect(requestRow(alice.page, RED)).toContainText("foil preferred");

  // --- Bob changes his mind, then leaves ------------------------------------------
  await clickTab(bob.page, /Requests/);
  await requestRow(bob.page, RED, alice.name).getByRole("button", { name: "Bringing 2" }).click();
  const pledgeSheet = sheet(bob.page, "Your pledge");
  await setQuantity(pledgeSheet, "How many will you bring", 1);
  await pledgeSheet.getByRole("button", { name: "Update pledge" }).click();
  await expect(requestRow(bob.page, RED, alice.name)).toContainText("1 of 2 coming");

  await bob.page.getByRole("button", { name: "I can't make it" }).click();
  await expect(bob.page.getByText("Can't make it?")).toBeVisible();
  await expect(bob.page.getByText("You're bringing 1 card for others.")).toBeVisible();
  await bob.page.getByRole("button", { name: "I'm still going" }).click();
  await expect(bob.page.getByText("Can't make it?")).toBeHidden();
  await bob.page.getByRole("button", { name: "I can't make it" }).click(); // opens the confirmation
  await bob.page.getByRole("button", { name: "I can't make it" }).click(); // confirms
  await expect(bob.page.getByRole("button", { name: "I'm going" })).toBeVisible();

  // The card is needed again on Alice's screen, and she's told why.
  await expect(requestRow(alice.page, RED)).toContainText("Need 2");
  await alice.page.goto("/notifications");
  await expect(alice.page.getByText(new RegExp(`${bob.name} can't make it anymore, so 1× .+ is needed again`))).toBeVisible();
  // Opening the inbox marks everything read.
  await alice.page.goto("/");
  await expect(alice.page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();

  // --- Alice cancels the blue request ------------------------------------------------
  await openEvent(alice.page, eventId, "checklist");
  await requestRow(alice.page, BLUE).getByRole("button", { name: "Edit" }).click();
  const cancel = sheet(alice.page, "Edit request");
  await cancel.getByRole("button", { name: "Cancel request" }).click();
  await cancel.getByRole("button", { name: "Keep it" }).click();
  await cancel.getByRole("button", { name: "Cancel request" }).click();
  await cancel.getByRole("button", { name: "Cancel request" }).last().click();
  await expect(cancel).toBeHidden();
  await expect(requestRow(alice.page, BLUE)).toHaveCount(0);

  const { data: rows } = await admin()
    .from("requests")
    .select("card_id, quantity, status, note")
    .eq("event_id", eventId)
    .eq("requester_id", alice.id)
    .order("card_id");
  expect(rows).toEqual([
    { card_id: "e2e-snatch-blue", quantity: 1, status: "cancelled", note: "any printing is fine" },
    { card_id: "e2e-snatch-red", quantity: 2, status: "active", note: "foil preferred" },
  ]);
});

test("paste a card list: matches, colours, typos and unknown cards", async ({ newPlayer }) => {
  const me = await newPlayer();
  const eventId = await currentEventId(me.db, E2E_STORE_ID);
  await openEvent(me.page, eventId);
  await attend(me.page);
  await clickTab(me.page, /Requests/);

  await me.page.getByRole("button", { name: "+ Request cards" }).click();
  const add = sheet(me.page, "Request cards");
  await add.getByRole("tab", { name: "Paste list" }).click();
  await expect(add.getByRole("button", { name: "Check list" })).toBeDisabled();
  await add.getByLabel("Card list").fill(
    [
      "# my list",
      `2x ${CARDS.snatch} (Yellow)`,
      `${CARDS.snatch}`, // multi-colour without a colour → Red by default
      `1 ${CARDS.sledge}`,
      "Zeetest Sledg", // typo → still found
      "3 Definitely Not A Real Card Qwerty",
    ].join("\n"),
  );
  await add.getByRole("button", { name: "Check list" }).click();

  // 2 yellow + 1 red (default) + 2 sledge (exact line and typo line merged).
  await expect(add.getByText("Found 5 cards. Check before requesting:")).toBeVisible();
  await expect(add.getByText(`2× ${YELLOW}`)).toBeVisible();
  await expect(add.getByText(`1× ${RED}`)).toBeVisible();
  await expect(add.getByText(`2× ${CARDS.sledge}`)).toBeVisible();
  await expect(add.getByText("You typed “Zeetest Sledg”")).toBeVisible();
  await expect(add.getByText(/Not found \/ not imported \(1\)/)).toBeVisible();
  await expect(add.getByText("3 Definitely Not A Real Card Qwerty")).toBeVisible();

  // Going back keeps the text.
  await add.getByRole("button", { name: "Edit list" }).click();
  await expect(add.getByLabel("Card list")).toHaveValue(/Definitely Not A Real Card/);
  await add.getByRole("button", { name: "Check list" }).click();

  // Switch the defaulted red to blue, and drop the yellow line.
  const defaulted = add.locator("li", { hasText: "Red by default · switch:" });
  await defaulted.getByRole("button", { name: "Use Blue" }).click();
  await expect(add.getByText(`1× ${BLUE}`)).toBeVisible();
  await add.getByRole("button", { name: `Don't import ${YELLOW}` }).click();
  await expect(add.getByText(`2× ${YELLOW}`)).toHaveCount(0);

  await add.getByRole("button", { name: "Request 3 cards" }).click();
  await expect(add).toBeHidden();

  await expect(requestRow(me.page, BLUE)).toContainText("Need 1");
  await expect(requestRow(me.page, CARDS.sledge)).toContainText("Need 2");
  await expect(requestRow(me.page, YELLOW)).toHaveCount(0);
  await expect(requestRow(me.page, RED)).toHaveCount(0);
});

test("quantity limits: 1–20 per card", async ({ newPlayer }) => {
  const me = await newPlayer();
  const eventId = await currentEventId(me.db, E2E_STORE_ID);
  await openEvent(me.page, eventId, "checklist");
  await attend(me.page);

  await me.page.getByRole("button", { name: "+ Request cards" }).click();
  const add = sheet(me.page, "Request cards");
  await pickCard(add, CARDS.sledge); // single version: selected straight away
  const stepper = add.getByRole("group", { name: `How many ${CARDS.sledge}` });
  await expect(stepper.getByRole("button", { name: "Fewer" })).toBeDisabled();
  await setQuantity(add, `How many ${CARDS.sledge}`, 20);
  await expect(stepper.getByRole("button", { name: "More" })).toBeDisabled();

  // Closing the sheet with ✕ discards it; reopening starts fresh.
  await add.getByRole("button", { name: "Close" }).click();
  await expect(add).toBeHidden();
  await me.page.getByRole("button", { name: "+ Request cards" }).first().click();
  await expect(add.getByRole("combobox")).toHaveValue("");

  await pickCard(add, CARDS.sledge);
  await setQuantity(add, `How many ${CARDS.sledge}`, 20);
  await add.getByRole("button", { name: "Request 20 cards" }).click();
  await expect(add).toBeHidden();

  // Asking again adds to the existing request, capped at 20, as one row.
  await me.page.getByRole("button", { name: "+ Request cards" }).first().click();
  await pickCard(add, CARDS.sledge);
  await add.getByRole("button", { name: "Request 1 card" }).click();
  await expect(requestRow(me.page, CARDS.sledge)).toHaveCount(1);
  await expect(requestRow(me.page, CARDS.sledge)).toContainText("Need 20");
});

test("one request per colour (paste and All colors) and editing or cancelling from the Requests tab", async ({ newPlayer }) => {
  const me = await newPlayer();
  const eventId = await currentEventId(me.db, E2E_STORE_ID);
  await openEvent(me.page, eventId);
  await attend(me.page);
  await clickTab(me.page, /Requests/);

  // A bare colour word after the name picks that colour.
  await me.page.getByRole("button", { name: "+ Request cards" }).click();
  const add = sheet(me.page, "Request cards");
  await add.getByRole("tab", { name: "Paste list" }).click();
  await add.getByLabel("Card list").fill(
    [`2x ${CARDS.snatch} red`, `2x ${CARDS.snatch} yellow`, `2x ${CARDS.snatch} blue`].join("\n"),
  );
  await add.getByRole("button", { name: "Check list" }).click();
  await expect(add.getByText("Found 6 cards. Check before requesting:")).toBeVisible();
  for (const label of [RED, YELLOW, BLUE]) await expect(add.getByText(`2× ${label}`)).toBeVisible();
  await add.getByRole("button", { name: "Request 6 cards" }).click();
  await expect(add).toBeHidden();
  for (const label of [RED, YELLOW, BLUE]) await expect(requestRow(me.page, label)).toContainText("Need 2");

  // "All colors" in search selects every version; each adds to its own request.
  await me.page.getByRole("button", { name: "+ Request cards" }).click();
  await pickCard(add, CARDS.snatch);
  await add.getByRole("button", { name: "All colors" }).click();
  for (const color of ["Red", "Yellow", "Blue"]) {
    await expect(add.getByRole("button", { name: new RegExp(`^${color}`) })).toHaveAttribute("aria-pressed", "true");
  }
  await add.getByRole("button", { name: "Request 3 cards" }).click();
  await expect(add).toBeHidden();
  for (const label of [RED, YELLOW, BLUE]) await expect(requestRow(me.page, label)).toContainText("Need 3");

  // Your own request can be edited right on the Requests tab.
  await requestRow(me.page, YELLOW).getByRole("button", { name: "Edit" }).click();
  const edit = sheet(me.page, "Edit request");
  await setQuantity(edit, "How many do you need", 5);
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  await expect(requestRow(me.page, YELLOW)).toContainText("Need 5");

  // …and cancelled there in two taps, with a chance to back out.
  await requestRow(me.page, BLUE).getByRole("button", { name: `Cancel request for ${BLUE}` }).click();
  const cancel = sheet(me.page, "Cancel request?");
  await expect(cancel).toContainText(`3× ${BLUE}`);
  await cancel.getByRole("button", { name: "Keep it" }).click();
  await expect(cancel).toBeHidden();
  await expect(requestRow(me.page, BLUE)).toContainText("Need 3");
  await requestRow(me.page, BLUE).getByRole("button", { name: `Cancel request for ${BLUE}` }).click();
  await cancel.getByRole("button", { name: "Cancel request" }).click();
  await expect(cancel).toBeHidden();
  await expect(requestRow(me.page, BLUE)).toHaveCount(0);
  await expect(requestRow(me.page, RED)).toContainText("Need 3");
});
