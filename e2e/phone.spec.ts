import { devices } from "@playwright/test";
import { expect, mockVault, test } from "./vault";

test.use({ ...devices["Pixel 7"], browserName: "chromium" });

const FILES = {
  "Start here.md": "# Start here\n\nWhat this vault is for.\n",
  "Architecture/Overview.md": "# Overview\n\nHow Netherstone is put together.\n",
  "Architecture/Backend/Git sync.md": "# Git sync\n\nThis keeps the vault in a private repository.\n",
  "Journal/2026-11-19.md": "# 2026-11-19\n\nA quiet day.\n",
};

test("home shows search, recent, folders and top-level shards", async ({ page }) => {
  await mockVault(page, { files: FILES, nested: true });
  await expect(page.locator("#splash")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Search this vault" })).toBeVisible();
  await page.screenshot({ path: "test-results/phone-home.png" });
});

test("a folder opens a shard on its own screen, and Back steps out again", async ({ page }) => {
  await mockVault(page, { files: FILES, nested: true });
  await page.getByRole("button", { name: /^Architecture/ }).click();
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();
  await page.getByRole("button", { name: /^Overview/ }).click();
  await expect(page.locator("[data-slate-editor]")).toContainText("How Netherstone is put together.");
  await page.screenshot({ path: "test-results/phone-shard.png" });

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("button", { name: "Search this vault" })).toBeVisible();
});

test("pressing and holding a row opens its menu, and Pin pins it", async ({ page }) => {
  await mockVault(page, { files: FILES, nested: true });
  await page.getByRole("button", { name: /^Start here/ }).click({ button: "right" });
  const menu = page.getByRole("dialog", { name: "Start here" });
  await expect(menu.getByRole("button", { name: "Move to trash" })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: "test-results/phone-row-menu.png" });
  await menu.getByRole("button", { name: "Pin" }).click();

  await expect(menu).toBeHidden();
  const pinned = page.getByRole("region", { name: "Pinned" });
  await expect(pinned.getByRole("button", { name: /^Start here/ })).toBeVisible();
});

test("swiping a row left shows Pin and Delete, and Delete asks first", async ({ page }) => {
  await mockVault(page, { files: FILES, nested: true });
  const row = page.getByRole("button", { name: /^Start here/ });
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 20, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, y, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByRole("button", { name: "Pin", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/phone-row-swipe.png" });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const ask = page.getByRole("alertdialog", { name: "Move “Start here” to trash?" });
  await ask.getByRole("button", { name: "Move to trash" }).click();

  await expect(ask).toBeHidden();
  const deleted = await page.evaluate(() =>
    window.__commands
      .filter((c) => c.command === "delete_vault_path")
      .map((c) => (c.args as { targetPath: string }).targetPath),
  );
  expect(deleted).toEqual(["/home/me/Vault/Start here.md"]);
});

test("select mode picks shards, pins them together, and Back leaves it", async ({ page }) => {
  await mockVault(page, { files: FILES, nested: true });
  await page.getByRole("button", { name: /^Architecture/ }).click();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Select" }).click();

  await expect(page.getByRole("heading", { name: "0 selected" })).toBeVisible();
  // Only shards are picked, so the folder inside isn't shown.
  await expect(page.getByRole("button", { name: /^Backend/ })).toHaveCount(0);
  await page.getByRole("checkbox", { name: /^Overview/ }).click();
  await expect(page.getByRole("heading", { name: "1 selected" })).toBeVisible();
  await page.screenshot({ path: "test-results/phone-select.png" });

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Select" }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByRole("heading", { name: "1 selected" })).toBeVisible();
  await page.getByRole("button", { name: "Pin", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const pinned = page.getByRole("region", { name: "Pinned" });
  await expect(pinned.getByRole("button", { name: /^Overview/ })).toBeVisible();
});
