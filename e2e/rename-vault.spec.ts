import type { Page } from "@playwright/test";
import { expect, mockVault, test, VAULT_PATH } from "./vault";

const FILES = { "Note.md": "# Note\n\nStart\n" };

async function startRename(page: Page, rename: string) {
  await page.evaluate((rename) => {
    window.__overrides = {
      rename_vault: (args) => {
        const { name } = args as { name: string };
        if (rename !== "ok") throw rename;
        return `/home/me/${name.trim()}`;
      },
    };
  }, rename);
  await page.getByRole("button", { name: "Vault", exact: true }).click();
  await page.getByRole("menuitem", { name: "Vault settings" }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  return page.getByRole("textbox", { name: "Vault name" });
}

test("renaming the vault keeps it open, and in its place among the recent vaults", async ({
  page,
}) => {
  await mockVault(page, {
    files: FILES,
    open: "Note.md",
    otherVaults: ["/home/me/Recipes"],
  });

  const field = await startRename(page, "ok");
  await expect(field).toHaveValue("Vault");
  await field.fill("Journal");
  await field.press("Enter");

  await expect(page.getByRole("button", { name: "Journal", exact: true })).toBeVisible();
  await expect(page.getByText("/home/me/Journal", { exact: true })).toBeVisible();
  const renames = await page.evaluate(() =>
    window.__commands.filter(({ command }) => command === "rename_vault"),
  );
  expect(renames).toEqual([
    { command: "rename_vault", args: { vaultPath: VAULT_PATH, name: "Journal" } },
  ]);
  const kept = await page.evaluate(
    () => JSON.parse(localStorage.getItem("netherstone-vault") ?? "{}").state,
  );
  expect(kept).toEqual({
    currentVaultPath: "/home/me/Journal",
    recentVaults: ["/home/me/Journal", "/home/me/Recipes"],
  });
  const ui = await page.evaluate(
    () => JSON.parse(localStorage.getItem("netherstone-ui") ?? "{}").state,
  );
  expect(ui.recentFiles[0].path).toBe("/home/me/Journal/Note.md");
});

test("a name that can't be used says why and keeps the vault as it was", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, open: "Note.md" });

  const field = await startRename(page, "vault-name-taken");
  await field.fill("Recipes");
  await page.getByRole("button", { name: "Rename", exact: true }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "There's already a folder with that name next to this vault.",
  );
  await expect(field).toHaveValue("Recipes");
  await field.press("Escape");
  await expect(field).toBeHidden();
  await expect(page.getByText(VAULT_PATH, { exact: true })).toBeVisible();
});
