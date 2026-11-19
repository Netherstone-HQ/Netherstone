import type { Page } from "@playwright/test";

import tauriConfig from "../src-tauri/tauri.conf.json" with { type: "json" };
import { expect, mockVault, test } from "./vault";

/** Settings in a narrow window: every control stays beside or under its label, inside its card. */

const FILES = { "Trip.md": "# Trip\n\nLisbon in May, by train.\n" };

const READY = { provider: true, vaultAllowed: true, picked: true };

const NARROW = 640;
const SMALLEST = tauriConfig.app.windows[0].minWidth;
const HEIGHT = 900;

async function openSettings(page: Page, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await page.evaluate(() => {
    window.__overrides = {
      ...window.__overrides,
      ai_apps: () => [],
      mcp_get_enabled: () => true,
    };
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  return page.getByRole("navigation", { name: "Settings" });
}

/** Rows whose control covers its label or runs past its card. */
function crampedRows(page: Page) {
  return page.evaluate(() => {
    const overlap = (a: DOMRect, b: DOMRect) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const cramped: string[] = [];
    for (const card of document.querySelectorAll('[data-slot="settings-card"]')) {
      const box = card.getBoundingClientRect();
      for (const row of card.querySelectorAll('[data-slot="setting-row"]')) {
        const label = row.firstElementChild!.getBoundingClientRect();
        const control = row.lastElementChild!.getBoundingClientRect();
        const inside = [...row.querySelectorAll("*")].every((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width === 0 ||
            (rect.left >= box.left &&
              rect.right <= box.right &&
              rect.top >= box.top &&
              rect.bottom <= box.bottom)
          );
        });
        if (row.childElementCount > 1 && overlap(label, control)) {
          cramped.push(`${row.textContent} covers its label`);
        }
        if (!inside) cramped.push(`${row.textContent} leaves its card`);
      }
    }
    return cramped;
  });
}

test("keeps the model picker clear of its label and inside the card", async ({ page }) => {
  const nav = await openSettings(page, NARROW);
  await nav.getByRole("button", { name: "AI assistant" }).click();

  const row = page.locator('[data-slot="setting-row"]', {
    has: page.getByText("Model", { exact: true }),
  });
  const label = await row.getByText("Model", { exact: true }).boundingBox();
  const picker = await row.getByRole("button", { name: "Model" }).boundingBox();
  const card = await page
    .locator('[data-slot="settings-card"]', { has: row })
    .boundingBox();
  if (!label || !picker || !card) throw new Error("Model row not laid out");

  const apart =
    label.x + label.width <= picker.x || label.y + label.height <= picker.y;
  expect(apart).toBe(true);
  expect(picker.x).toBeGreaterThanOrEqual(card.x);
  expect(picker.x + picker.width).toBeLessThanOrEqual(card.x + card.width);
});

for (const width of [NARROW, SMALLEST]) {
  test(`fits every settings row at ${width} px`, async ({ page }) => {
    const nav = await openSettings(page, width);
    const categories = await nav.getByRole("button").all();
    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      const name = await category.textContent();
      await category.click();
      await expect(page.getByRole("heading", { level: 2, name: name! })).toBeVisible();
      expect(await crampedRows(page)).toEqual([]);
    }
  });
}

test("names each settings category on hover once only the icons are left", async ({
  page,
}) => {
  const nav = await openSettings(page, SMALLEST);
  await nav.getByRole("button", { name: "Vault" }).hover();
  await expect(page.getByRole("tooltip", { name: "Vault" })).toBeVisible();
});
