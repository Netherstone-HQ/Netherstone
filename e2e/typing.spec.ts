import { expect, test } from "@playwright/test";
import { caretAfter, editor, lastSave, mockVault, savesFor } from "./vault";

const FILES = {
  "Note.md": "# Note\n\nStart here.\n",
  "Other.md": "# Other\n",
};

test("typed text is saved as Markdown", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });

  await caretAfter(page, "Start here.");
  await page.keyboard.type(" Then more.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A new paragraph.");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toBe("# Note\n\nStart here. Then more.\n\nA new paragraph.\n");
});

test("keyboard formatting shortcuts save as marks", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });

  await caretAfter(page, "Start here.");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+B");
  await page.keyboard.type("bold");
  await page.keyboard.press("Control+B");
  await page.keyboard.type(" and ");
  await page.keyboard.press("Control+I");
  await page.keyboard.type("italic");
  await page.keyboard.press("Control+I");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("**bold** and _italic_");
});

test("opening a shard without editing it writes nothing", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });

  await expect(editor(page)).toContainText("Start here.");
  await page.waitForTimeout(4000);

  expect(await savesFor(page, "Note.md")).toEqual([]);
});
