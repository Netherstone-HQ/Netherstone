import { editor, expect, mockVault, test } from "./vault";

/**
 * The history panel: an earlier version shows in the editor's place with
 * what restoring it would change, and restoring it puts it back.
 */

const now = Math.floor(Date.now() / 1000);

async function openHistoryOn(page: import("@playwright/test").Page) {
  await mockVault(page, {
    files: { "Bread.md": "# Bread\n\nUse 350 g water.\n" },
    open: "Bread.md",
    versions: {
      "Bread.md": [
        {
          time: now - 3600,
          content: "# Bread\n\nUse 375 g water.\n\nRest an hour.\n",
          added: 3,
          removed: 1,
        },
        { time: now - 7200, content: "# Bread\n", kind: "created" },
      ],
    },
  });
  await expect(editor(page)).toContainText("350 g");
  await page.getByRole("button", { name: "Show history" }).click();
  return page.getByRole("complementary", { name: "History" });
}

test("lists versions by day under Now", async ({ page }) => {
  const panel = await openHistoryOn(page);
  await expect(panel.getByText("Now")).toBeVisible();
  await expect(panel.getByText("Current")).toBeVisible();
  await expect(panel.getByText("Added 3 words, removed 1")).toBeVisible();
  await expect(panel.getByText("Created")).toBeVisible();
});

test("shows an earlier version with what a restore would change", async ({
  page,
}) => {
  const panel = await openHistoryOn(page);
  await panel.getByText("Added 3 words, removed 1").click();

  const version = page.getByLabel("Earlier version");
  await expect(version).toContainText("Rest an hour.");
  await expect(version.locator(".history-added").first()).toHaveText("375");
  await expect(version.locator(".history-removed").first()).toHaveText("350");

  // Off: the version as it was saved.
  await page.getByText("Show changes").click();
  await expect(version.locator(".history-removed").first()).toBeHidden();

  // Back to Now: the editor and its toolbar, unchanged.
  await panel.getByText("Now").click();
  await expect(page.getByLabel("Earlier version")).toHaveCount(0);
  await expect(editor(page)).toContainText("350 g");
});

test("restores a version, and Undo brings the shard back", async ({ page }) => {
  const panel = await openHistoryOn(page);
  await panel.getByText("Added 3 words, removed 1").click();
  await page.getByRole("button", { name: "Restore this version" }).click();

  await expect(editor(page)).toContainText("Use 375 g water.");
  await expect(editor(page)).toContainText("Rest an hour.");
  await expect(page.getByLabel("Earlier version")).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(editor(page)).toContainText("Use 350 g water.");
  await expect(editor(page)).not.toContainText("Rest an hour.");
});

test("a shard without versions says so", async ({ page }) => {
  await mockVault(page, { files: { "New.md": "# New\n" }, open: "New.md" });
  await page.getByRole("button", { name: "Show history" }).click();
  await expect(page.getByText("No earlier versions yet")).toBeVisible();
});
