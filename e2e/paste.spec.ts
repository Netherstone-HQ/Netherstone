import { caretAfter, cellsOf, editor, expect, lastSave, mockVault, paste, test } from "./vault";

const FILES = {
  "Note.md": "# Note\n\nPaste below:\n",
};

const HTML_TABLE =
  '<meta charset="utf-8"><table><thead><tr><th>Country</th><th>Capital</th><th>Notes</th></tr></thead>' +
  "<tbody><tr><td>France</td><td>Paris</td><td>The capital and largest city.</td></tr>" +
  "<tr><td>Japan</td><td>Tokyo</td><td>Short</td></tr></tbody></table>";

test("an HTML table from another app pastes as a table", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Paste below:");
  await page.keyboard.press("Enter");

  await paste(page, {
    html: HTML_TABLE,
    text: "Country\tCapital\tNotes\nFrance\tParis\tThe capital and largest city.\nJapan\tTokyo\tShort",
  });

  const table = editor(page).locator("table");
  await expect(table).toHaveCount(1);
  await expect(table.locator("tr")).toHaveCount(3);
  await expect(cellsOf(table.locator("tr").first())).toHaveCount(3);
  await expect(table).toContainText("The capital and largest city.");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("| Country | Capital | Notes");
  expect(saved).toMatch(/\| France\s+\| Paris\s+\| The capital and largest city\.\s+\|/);
});

test("a Markdown table pasted as text becomes a table", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Paste below:");
  await page.keyboard.press("Enter");

  await paste(page, { text: "| x | y |\n| - | - |\n| 1 | 2 |\n" });

  const table = editor(page).locator("table");
  await expect(table).toHaveCount(1);
  await expect(table.locator("tr")).toHaveCount(2);

  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("| x | y |");
  expect(saved).toContain("| 1 | 2 |");
});

test("pasted Markdown text keeps its formatting", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Paste below:");
  await page.keyboard.press("Enter");

  await paste(page, {
    text: "## Pasted heading\n\n- one\n- two\n\nSome **bold** text.\n",
  });

  await expect(editor(page).locator("h2")).toContainText("Pasted heading");
  await expect(editor(page).locator("strong")).toContainText("bold");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("## Pasted heading");
  expect(saved).toContain("- one\n- two");
  expect(saved).toContain("**bold**");
});

test("text pasted from a web page drops the page's colour, font and size", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Paste below:");
  await page.keyboard.press("Enter");

  const style = 'style="color: rgb(31, 31, 31); font-family: &quot;Google Sans Text&quot;, sans-serif; font-size: 18px;"';
  await paste(page, {
    html:
      `<meta charset="utf-8"><ul ${style}><li><span ${style}>` +
      `<b ${style}>The Alchemist</b> represents your drive for transformation.</span></li></ul>`,
    text: "The Alchemist represents your drive for transformation.",
  });

  await expect(editor(page).locator("strong")).toContainText("The Alchemist");
  await expect(editor(page).locator("[style*='color'], [style*='font']")).toHaveCount(0);

  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("**The Alchemist** represents your drive for transformation.");
  expect(saved).not.toContain("<span");
});

const selectAllBlocks = async (page: import("@playwright/test").Page) => {
  await caretAfter(page, "Paste below:");
  // The first select all takes the block's text, the second every block.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator(".slate-shadow-input")).toBeFocused();
};

test("copying every selected block puts them all on the clipboard", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await selectAllBlocks(page);

  await page.keyboard.press("ControlOrMeta+c");

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Note");
  expect(copied).toContain("Paste below:");
});

test("pasting over selected blocks replaces them, and undo brings them back", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await selectAllBlocks(page);

  await paste(page, { text: "Replacement" });

  await expect(editor(page)).toContainText("Replacement");
  await expect(editor(page)).not.toContainText("Paste below:");
  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("Replacement");
  expect(saved).not.toContain("# Note");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor(page)).toContainText("Paste below:");
  await expect(editor(page)).not.toContainText("Replacement");
});
