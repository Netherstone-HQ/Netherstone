import { caretAfter, editor, expect, lastSave, mockVault, test } from "./vault";

const FILES = {
  "Note.md": "# Note\n\nStart\n",
};

async function slash(page: import("@playwright/test").Page, query: string) {
  await page.keyboard.type(`/${query}`, { delay: 40 });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
}

test("blocks from the / menu are saved as Markdown", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");

  await slash(page, "heading 2");
  await page.keyboard.type("Second level");
  await page.keyboard.press("Enter");

  await slash(page, "bullet");
  await page.keyboard.type("first item");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second item");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  await slash(page, "code");
  await page.keyboard.type("const x = 1;");

  await expect(editor(page).locator("h2")).toContainText("Second level");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("## Second level");
  expect(saved).toContain("- first item\n- second item");
  expect(saved).toContain("```\nconst x = 1;\n```");
});

test("a table from the / menu is saved as a pipe table", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");

  await slash(page, "table");
  await expect(editor(page).locator("table")).toHaveCount(1);
  await page.keyboard.type("cell one");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("| cell one");
  expect(saved).toMatch(/\n\| -+ \| -+ \|/);
});

test("a quote from the / menu keeps the caret inside it", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");

  await slash(page, "quote");
  await page.keyboard.type("Quoted line");

  await expect(editor(page).locator("blockquote")).toContainText("Quoted line");
  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("Start\n\n> Quoted line");
});

test("/block finds Blockquote, not every block in the menu", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");

  await page.keyboard.type("/block", { delay: 40 });
  const options = page.getByRole("option");
  await expect(options.filter({ hasText: "Blockquote" })).toBeVisible();
  await expect(options.filter({ hasText: "Heading 1" })).toHaveCount(0);
});

test("a code block from the / menu in a list stays in the list item", async ({ page }) => {
  await mockVault(page, {
    files: { "List.md": "# List\n\n- First item\n- Second item\n" },
    open: "List.md",
  });
  await caretAfter(page, "First item");
  await page.keyboard.press("Enter");

  await slash(page, "code");
  await page.keyboard.type("x = 1");

  const saved = await lastSave(page, "List.md");
  expect(saved).toContain("- First item\n\n  ```\n  x = 1\n  ```\n- Second item");
});
