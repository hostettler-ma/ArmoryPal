import { expect, type Locator, type Page } from "@playwright/test";

/** Opens an event page on a tab and waits for it to render. */
export async function openEvent(page: Page, eventId: string, tab: "going" | "requests" | "checklist" = "going") {
  await page.goto(`/events/${eventId}?tab=${tab}`);
  await expect(page.getByRole("navigation", { name: "Event sections" })).toBeVisible();
}

export async function clickTab(page: Page, name: RegExp) {
  await page.getByRole("navigation", { name: "Event sections" }).getByRole("link", { name }).click();
  await expect(page.getByRole("navigation", { name: "Event sections" }).getByRole("link", { name })).toHaveAttribute(
    "aria-current",
    "page",
  );
}

export async function attend(page: Page) {
  await page.getByRole("button", { name: "I'm going" }).click();
  await expect(page.getByRole("button", { name: "I can't make it" })).toBeVisible();
}

/** The open bottom sheet (a <dialog>) with this title. */
export const sheet = (page: Page, title: string): Locator => page.getByRole("dialog", { name: title });

/** Picks a card in the autocomplete and (for multi-colour cards) toggles the colours. */
export async function pickCard(dialog: Locator, cardName: string, colors: string[] = []) {
  const box = dialog.getByRole("combobox");
  await box.fill(cardName.slice(0, -2)); // type most of it, like a person would
  await dialog.getByRole("option", { name: new RegExp(cardName) }).click();
  for (const color of colors) {
    const toggle = dialog.getByRole("group", { name: /Which colors/ }).getByRole("button", { name: new RegExp(color) });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }
}

/** Sets a QuantityStepper (role=group, labelled) to `target` by clicking −/+. */
export async function setQuantity(scope: Locator, label: string, target: number) {
  const group = scope.getByRole("group", { name: label });
  const output = group.locator("output");
  for (let i = 0; i < 25; i++) {
    const current = Number(await output.textContent());
    if (current === target) return;
    await group.getByRole("button", { name: current < target ? "More" : "Fewer" }).click();
    await expect(output).not.toHaveText(String(current));
  }
  throw new Error(`Couldn't set ${label} to ${target}`);
}

/** The request card for one card label (e.g. "Zeetest Snatch (Red)"), optionally for one requester. */
export function requestRow(page: Page, cardLabel: string, requester?: string): Locator {
  let rows = page.locator("li.card").filter({ has: page.getByText(cardLabel, { exact: true }) });
  if (requester) rows = rows.filter({ hasText: requester });
  return rows;
}
