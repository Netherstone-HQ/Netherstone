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
  expect(saved).toContain("Start see [Other Note](Other%20Note.md) now");
});

test("a relative link to a shard in a folder shows as an @ link and keeps its path", async ({
  page,
}) => {
  await mockVault(page, {
    files: {
      ...FILES,
      "Projects/Plan.md": "# Plan\n\nThe plan.\n",
      "Note.md": "# Note\n\nRead [the plan](Projects/Plan.md) first.\n",
    },
    open: "Note.md",
  });

  const chip = editor(page).locator("[data-slate-value='the plan']");
  await expect(chip).toBeVisible();

  await caretAfter(page, "first.");
  await page.keyboard.type(" Edited.");
  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("Read [the plan](Projects/Plan.md) first. Edited.");

  await chip.click();
  await expect(editor(page)).toContainText("The plan.");
});

test("an old mention: link still opens the linked shard, and saves as a relative link", async ({
  page,
}) => {
  await mockVault(page, {
    files: {
      ...FILES,
      "Note.md": "# Note\n\nSee [Other Note](mention:Other%20Note) now.\n",
    },
    open: "Note.md",
  });

  const chip = editor(page).getByText("Other Note", { exact: true }).first();
  await expect(chip).toBeVisible();

  await caretAfter(page, "now.");
  await page.keyboard.type(" Edited.");
  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("See [Other Note](Other%20Note.md) now. Edited.");

  await chip.click();
  await expect(editor(page)).toContainText("Content.");
});
