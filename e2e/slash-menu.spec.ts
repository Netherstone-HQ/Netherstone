import {
  caretAfter,
  editor,
  expect,
  lastSave,
  menuClosed,
  mockVault,
  pickOption,
  test,
} from "./vault";

const FILES = {
  "Note.md": "# Note\n\nStart\n",
};

async function slash(page: import("@playwright/test").Page, query: string, option: string) {
  await page.keyboard.type(`/${query}`);
  // The list narrows a step behind the typing, so wait for the option this
  // query ends on, not whichever is first right now.
  await pickOption(page, page.getByRole("option", { name: option, exact: true }));
}

test("blocks from the / menu are saved as Markdown", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");

  await slash(page, "heading 2", "Heading 2");
  await page.keyboard.type("Second level");
  await page.keyboard.press("Enter");

  await slash(page, "bullet", "Bulleted list");
  await page.keyboard.type("first item");
  await page.keyboard.press("Enter");
  await page.keyboard.type("second item");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  await slash(page, "code", "Code block");
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

  await slash(page, "table", "Table");
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

  await slash(page, "quote", "Blockquote");
  await page.keyboard.type("Quoted line");

  await expect(editor(page).locator("blockquote")).toContainText("Quoted line");
  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("Start\n\n> Quoted line");
});

test("/block finds Blockquote, not every block in the menu", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");

  await page.keyboard.type("/block");
  const options = page.getByRole("option");
  await expect(options.filter({ hasText: "Blockquote" })).toBeVisible();
  await expect(options.filter({ hasText: "Heading 1" })).toHaveCount(0);
});

test("/blo lists Blockquote before Code block", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");

  await page.keyboard.type("/blo");
  const options = page.getByRole("option");
  await expect(options).toHaveText(["Blockquote", "Code block"]);
});

test("a code block from the / menu in a list stays in the list item", async ({ page }) => {
  await mockVault(page, {
    files: { "List.md": "# List\n\n- First item\n- Second item\n" },
    open: "List.md",
  });
  await caretAfter(page, "First item");
  await page.keyboard.press("Enter");

  await slash(page, "code", "Code block");
  await page.keyboard.type("x = 1");

  const saved = await lastSave(page, "List.md");
  expect(saved).toContain("- First item\n\n  ```\n  x = 1\n  ```\n- Second item");
});

test("Enter before the menu's next frame picks the match for the whole text", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(page.getByRole("option").first()).toHaveAttribute("data-active-item", "true");

  // The menu's list catches up with the typing on the next animation frame.
  // Hold frames so Enter comes first, as on a busy machine. The highlight is
  // still on the list for "/" then, but Enter must pick 3 columns.
  await page.evaluate(() => {
    const held: FrameRequestCallback[] = [];
    const requestFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => held.push(callback);
    window.__releaseFrames = () => {
      window.requestAnimationFrame = requestFrame;
      for (const callback of held) callback(performance.now());
    };
  });
  await page.keyboard.type("col");
  await page.keyboard.press("Enter");
  await page.evaluate(() => window.__releaseFrames());

  await menuClosed(page);
  await page.keyboard.type("Left");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("<!-- netherstone columns: ");
  expect(saved).toContain("Left");
});
