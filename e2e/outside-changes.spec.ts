import {
  caretAfter,
  changeOutside,
  editor,
  expect,
  lastSave,
  mockVault,
  openShard,
  savesFor,
  test,
} from "./vault";

/**
 * A shard changed by another app while it's open shows the new text in
 * place, and autosave never writes over it.
 */

test("an outside change shows in the open shard without a save", async ({ page }) => {
  await mockVault(page, {
    files: { "Note.md": "# Note\n\nFirst.\n\nSecond.\n" },
    open: "Note.md",
  });
  await expect(editor(page)).toContainText("Second.");

  await changeOutside(page, "Note.md", "# Note\n\nFirst.\n\nSecond, from elsewhere.\n");
  await expect(editor(page)).toContainText("Second, from elsewhere.");

  await page.waitForTimeout(2500);
  expect(await savesFor(page, "Note.md")).toEqual([]);
});

test("unsaved typing and an outside change elsewhere are both kept", async ({ page }) => {
  await mockVault(page, {
    files: { "Note.md": "# Note\n\nFirst.\n\nSecond.\n" },
    open: "Note.md",
  });
  await caretAfter(page, "First.");
  await page.keyboard.type(" Typed.");

  await changeOutside(page, "Note.md", "# Note\n\nFirst.\n\nSecond, from elsewhere.\n");

  await expect(editor(page)).toContainText("Second, from elsewhere.");
  expect(await lastSave(page, "Note.md")).toBe(
    "# Note\n\nFirst. Typed.\n\nSecond, from elsewhere.\n",
  );
});

test("typing and an outside change to the same paragraph asks which to keep", async ({ page }) => {
  await mockVault(page, {
    files: { "Note.md": "# Note\n\nFirst.\n" },
    open: "Note.md",
  });
  await caretAfter(page, "First.");
  await page.keyboard.type(" Typed.");
  await changeOutside(page, "Note.md", "# Note\n\nFirst, from elsewhere.\n");

  await expect(page.getByText("Choose which version to keep")).toBeVisible();
  await page.waitForTimeout(2500);
  expect(await savesFor(page, "Note.md")).toEqual([]);

  await page.getByRole("button", { name: "Keep your version" }).click();
  expect(await lastSave(page, "Note.md")).toBe("# Note\n\nFirst. Typed.\n");
});

const PARAGRAPHS = 3000;

function longShard(last: string) {
  let markdown = "# Long\n\n";
  for (let i = 0; i < PARAGRAPHS; i += 1) {
    markdown += `Paragraph ${i} with **bold**, _italic_ and \`code\`.\n\n`;
  }
  return `${markdown}${last}\n`;
}

test("an outside change to a long shard updates it in place", async ({ page }) => {
  test.slow();
  await mockVault(page, {
    files: { "Small.md": "# Small\n\nHi\n", "Long.md": longShard("The end.") },
    open: "Small.md",
  });
  await expect(editor(page)).toContainText("Hi");

  const openStarted = Date.now();
  await openShard(page, "Long");
  await editor(page).getByText("Paragraph 0 with").waitFor({ timeout: 60_000 });
  const openMs = Date.now() - openStarted;

  const scroller = await editor(page).evaluateHandle((element) => {
    let node: Element | null = element;
    while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
    return node ?? document.scrollingElement!;
  });
  await scroller.evaluate((element: Element) => {
    element.scrollTop = 5000;
  });
  const scrollTop = await scroller.evaluate((element: Element) => element.scrollTop);

  const reloadStarted = Date.now();
  await changeOutside(page, "Long.md", longShard("The end, from elsewhere."));
  await editor(page).getByText("The end, from elsewhere.").waitFor({ timeout: 60_000 });
  const reloadMs = Date.now() - reloadStarted;

  console.log(`[outside-changes] open ${openMs} ms, outside change ${reloadMs} ms`);
  expect(await scroller.evaluate((element: Element) => element.scrollTop)).toBe(scrollTop);
  expect(reloadMs).toBeLessThan(openMs);
  expect(await savesFor(page, "Long.md")).toEqual([]);
});
