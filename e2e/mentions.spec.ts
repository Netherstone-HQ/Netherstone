import { expect, test } from "@playwright/test";
import { caretAfter, editor, lastSave, mockVault } from "./vault";

const FILES = {
  "Note.md": "# Note\n\nStart\n",
  "Other Note.md": "# Other Note\n\nContent.\n",
};

test("an @ link to another shard is inserted and saved as a link", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Start");
  await page.keyboard.type(" see @Oth", { delay: 40 });
  await expect(page.getByRole("option", { name: "Other Note" })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type(" now");

  await expect(editor(page)).toContainText("Other Note");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toMatch(/Start see \[Other Note\]\([^)]+\) now/);
});

test("a saved @ link opens the linked shard", async ({ page }) => {
  await mockVault(page, {
    files: {
      ...FILES,
      "Note.md": "# Note\n\nSee [Other Note](mention:Other%20Note) now.\n",
    },
    open: "Note.md",
  });

  const chip = editor(page).getByText("Other Note", { exact: true }).first();
  await expect(chip).toBeVisible();
  await chip.click();

  await expect(editor(page)).toContainText("Content.");
});
