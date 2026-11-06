import type { Page } from "@playwright/test";

import { expect, mockVault, test } from "./vault";

/**
 * The companion as the assistant: his menu, his spot on the panel, and the
 * companion he is today while the assistant is off. Reduced motion puts him
 * straight into each pose, so nothing waits on an animation.
 */

const FILES = { "Trip.md": "# Trip\n\nLisbon in May, by train.\n" };
const READY = {
  provider: true,
  vaultAllowed: true,
  picked: true,
  answer: ["We go to Lisbon in May."],
};

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const hit = (page: Page) => page.locator('.companion [data-part="hit"]');
const menu = (page: Page) => page.getByRole("menu", { name: "Kevin" });
const panel = (page: Page) => page.getByRole("complementary", { name: "Assistant" });
const SMILE = "M-2,-60Q2,-56 6,-60";

/** Where his feet are, in the window. */
async function feet(page: Page) {
  return page.locator(".companion").evaluate((host) => {
    const rect = host.getBoundingClientRect();
    return { x: Math.round(rect.left + 300 * 0.6), y: Math.round(rect.top + 150 * 0.6) };
  });
}

async function turnAssistantOff(page: Page) {
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  await page.getByRole("button", { name: "AI assistant" }).click();
  await page.getByRole("switch", { name: "Turn on the assistant" }).click();
  await expect(page.getByRole("switch", { name: "Turn on the assistant" })).not.toBeChecked();
  await settings.click();
}

test("is poked as today while the assistant is off", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", companion: true });
  await hit(page).click();
  // The poke: his mouth opens, then smiles again. No menu.
  await expect(page.locator('.companion [data-part="mouth"]')).not.toHaveAttribute("d", SMILE);
  await expect(page.locator('.companion [data-part="mouth"]')).toHaveAttribute("d", SMILE);
  await expect(menu(page)).toHaveCount(0);
});

test("opens his menu above him, and sends from the panel he sits on", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY, companion: true });
  await hit(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem")).toHaveText([
    "Ask about this shard",
    "Summarize this shard",
    "Find related shards",
    "Open chat",
    "Hide Kevin",
  ]);
  const box = (await menu(page).boundingBox())!;
  const at = await feet(page);
  expect(Math.round(box.width)).toBe(216);
  expect(Math.round(box.x + box.width)).toBe(at.x + 34);
  expect(box.y + box.height).toBeLessThanOrEqual(at.y - 66 + 1);

  await menu(page).getByRole("menuitem", { name: "Summarize this shard" }).click();
  await expect(panel(page).getByText("We go to Lisbon in May.")).toBeVisible();
  expect(await page.evaluate(() => window.__sent)).toEqual([
    { chat: null, text: "Summarize this shard", shards: ["Trip.md"] },
  ]);

  // He sits on the composer's top edge, 52 px in from its right edge, and
  // the messages leave room under him.
  const card = (await panel(page).locator(".border-input.bg-card").boundingBox())!;
  await expect.poll(() => feet(page)).toEqual({ x: Math.round(card.x + card.width - 52), y: Math.round(card.y + 1) });
  await expect(panel(page).locator(".overflow-y-auto").first()).toHaveCSS("padding-bottom", "96px");
});

test("asks about the shard in the composer", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY, companion: true });
  await hit(page).click();
  await menu(page).getByRole("menuitem", { name: "Ask about this shard" }).click();
  await expect(panel(page).getByRole("textbox", { name: "Message" })).toBeFocused();
  expect(await page.evaluate(() => window.__sent)).toEqual([]);
});

test("sleeps while no provider is set up", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: {}, companion: true });
  await expect(page.locator(".companion")).toHaveAttribute("data-zz", "");
  await expect(page.locator(".companion .companion-z").first()).toHaveCSS("opacity", "1");
});

test("turning the assistant off sends him back to his corner and leaves nothing behind", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY, companion: true });
  const corner = await feet(page);
  await page.getByRole("button", { name: "Show assistant" }).click();
  await expect.poll(() => feet(page)).not.toEqual(corner);

  await turnAssistantOff(page);
  await expect(panel(page)).toHaveCount(0);
  await expect.poll(() => feet(page)).toEqual(corner);
  await hit(page).click();
  await expect(page.locator('.companion [data-part="mouth"]')).not.toHaveAttribute("d", SMILE);
  await expect(page.locator('.companion [data-part="mouth"]')).toHaveAttribute("d", SMILE);
  await expect(menu(page)).toHaveCount(0);
});

test("hides from his menu", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY, companion: true });
  await hit(page).click();
  await menu(page).getByRole("menuitem", { name: "Hide Kevin" }).click();
  await expect(page.locator(".companion")).toHaveCount(0);
  // The assistant works without him.
  await page.getByRole("button", { name: "Show assistant" }).click();
  await panel(page).getByRole("button", { name: "Summarize this shard" }).click();
  await expect(panel(page).getByText("We go to Lisbon in May.")).toBeVisible();
});
