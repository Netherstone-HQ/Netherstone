import { expect, test } from "@playwright/test";
import { caretAfter, cellsOf, editor, lastSave, mockVault, paste } from "./vault";

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
