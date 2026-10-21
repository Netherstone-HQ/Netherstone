import type { Page } from "@playwright/test";
import { expect, mockVault, test } from "./vault";

const FILES = { "Note.md": "# Note\n\nStart\n" };

async function openVaultMenu(page: Page, name = "Vault") {
  await page.getByRole("button", { name, exact: true }).click();
  return page.getByRole("menu");
}

/** The menu's group names and items, top to bottom. */
function menuEntries(menu: ReturnType<Page["getByRole"]>) {
  return menu
    .locator('[data-slot="dropdown-menu-label"], [role="menuitem"]')
    .allInnerTexts();
}

test("the vault menu lists this vault, then the other vaults, then open and new", async ({
  page,
}) => {
  await mockVault(page, {
    files: FILES,
    open: "Note.md",
    otherVaults: ["/home/me/Work notes", "/home/me/Recipes"],
  });

  const menu = await openVaultMenu(page);
  expect(await menuEntries(menu)).toEqual([
    "This vault",
    "Import",
    "Show in file manager",
    "Vault settings",
    "Other vaults",
    "Work notes",
    "Recipes",
    "Open vault",
    "New vault",
  ]);
  await expect(menu.getByRole("menuitem", { name: "Recipes" })).toHaveAttribute(
    "title",
    "/home/me/Recipes",
  );
  await expect(menu.getByRole("separator")).toHaveCount(2);
});

test("with only one vault, the menu has no other vaults", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });

  const menu = await openVaultMenu(page);
  expect(await menuEntries(menu)).toEqual([
    "This vault",
    "Import",
    "Show in file manager",
    "Vault settings",
    "Open vault",
    "New vault",
  ]);
  await expect(menu.getByRole("separator")).toHaveCount(1);
});

test("Import in the vault menu opens the import dialog", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });

  const menu = await openVaultMenu(page);
  await menu.getByRole("menuitem", { name: "Import" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("with no vault open, the menu only opens or creates one", async ({ page }) => {
  await mockVault(page, { files: FILES, noVault: true });

  const menu = await openVaultMenu(page, "No vault");
  expect(await menuEntries(menu)).toEqual(["Open vault", "New vault"]);
});

test("with no shard open, the editor offers New shard and Import", async ({ page }) => {
  await mockVault(page, { files: FILES });

  await expect(page.getByRole("main").getByText("No shard open")).toBeVisible();
  const buttons = page.locator('[data-slot="empty-content"] button');
  await expect(buttons).toHaveText(["New shard", "Import"]);

  await buttons.filter({ hasText: "Import" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("with no vault open, the editor offers New vault and Open vault", async ({ page }) => {
  await mockVault(page, { files: FILES, noVault: true });

  await expect(page.getByText("No vault open")).toBeVisible();
  const buttons = page.locator('[data-slot="empty-content"] button');
  await expect(buttons).toHaveText(["New vault", "Open vault"]);

  await buttons.filter({ hasText: "New vault" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
