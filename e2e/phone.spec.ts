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
