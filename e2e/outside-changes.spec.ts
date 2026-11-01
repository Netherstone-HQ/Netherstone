import type { Page } from "@playwright/test";
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
  await page.clock.install();
  await mockVault(page, {
    files: { "Note.md": "# Note\n\nFirst.\n\nSecond.\n" },
    open: "Note.md",
  });
  await expect(editor(page)).toContainText("Second.");

  await changeOutside(page, "Note.md", "# Note\n\nFirst.\n\nSecond, from elsewhere.\n");
  await expect(editor(page)).toContainText("Second, from elsewhere.");

  await page.clock.runFor(2500);
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

test("outside changes before and after unsaved typing are all kept", async ({ page }) => {
  await mockVault(page, {
    files: { "Note.md": "# Note\n\nFirst.\n\nSecond.\n\nThird.\n" },
    open: "Note.md",
  });
  await caretAfter(page, "Second.");
  await page.keyboard.type(" Typed.");

  // As an assistant would: a new opening line and a change at the end.
  await changeOutside(
    page,
    "Note.md",
    "# Note\n\nAdded first.\n\nFirst.\n\nSecond.\n\nThird, from elsewhere.\n",
  );

  await expect(editor(page)).toContainText("Third, from elsewhere.");
  await expect(page.getByText("Choose which version to keep")).toHaveCount(0);
  // The caret stays put, so typing carries on where it was.
  await page.keyboard.type(" More.");
  expect(await lastSave(page, "Note.md")).toBe(
    "# Note\n\nAdded first.\n\nFirst.\n\nSecond. Typed. More.\n\nThird, from elsewhere.\n",
  );
});

test("undo after an outside change takes back your typing, not the change", async ({
  page,
}) => {
  await mockVault(page, {
    files: { "Note.md": "# Note\n\nFirst.\n\nSecond.\n" },
    open: "Note.md",
  });
  await caretAfter(page, "First.");
  await page.keyboard.type(" Typed.");
  await changeOutside(page, "Note.md", "# Note\n\nFirst.\n\nSecond, from elsewhere.\n");
  await expect
    .poll(() => lastSave(page, "Note.md"))
    .toBe("# Note\n\nFirst. Typed.\n\nSecond, from elsewhere.\n");

  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor(page)).not.toContainText("Typed.");
  await expect(editor(page)).toContainText("Second, from elsewhere.");
  await expect
    .poll(() => lastSave(page, "Note.md"))
    .toBe("# Note\n\nFirst.\n\nSecond, from elsewhere.\n");

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(() => lastSave(page, "Note.md"))
    .toBe("# Note\n\nFirst. Typed.\n\nSecond, from elsewhere.\n");
});

test("typing and an outside change to the same paragraph asks which to keep", async ({ page }) => {
  await page.clock.install();
  await mockVault(page, {
    files: { "Note.md": "# Note\n\nFirst.\n" },
    open: "Note.md",
  });
  await caretAfter(page, "First.");
  await page.keyboard.type(" Typed.");
  await changeOutside(page, "Note.md", "# Note\n\nFirst, from elsewhere.\n");

  await expect(page.getByText("Choose which version to keep")).toBeVisible();
  await page.clock.runFor(2500);
  expect(await savesFor(page, "Note.md")).toEqual([]);

  await page.getByRole("button", { name: "Keep your version" }).click();
  expect(await lastSave(page, "Note.md")).toBe("# Note\n\nFirst. Typed.\n");
});

test("the versions to choose from open on the change and mark what's missing", async ({
  page,
}) => {
  const filler = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}.`).join("\n\n");
  await mockVault(page, {
    files: { "Note.md": `# Note\n\n${filler}\n\nThe old cold end.\n` },
    open: "Note.md",
  });
  await caretAfter(page, "The old cold end.");
  await page.keyboard.type(" Typed.");
  await changeOutside(page, "Note.md", `# Note\n\n${filler}\n\nThe old end.\n`);

  const yours = page.locator(`[aria-label="Your version"]`);
  const outside = page.locator(`[aria-label="Outside version"]`);
  await expect(yours.locator(".history-added", { hasText: "cold" })).toBeInViewport();
  await expect(outside.locator(".history-gap")).toHaveCount(2);
  await expect(outside.locator(".history-gap").first()).toBeInViewport();
  await page.screenshot({ path: "test-results/conflict-preview.png" });
});

/** The element the open shard scrolls in. */
function editorScroller(page: Page) {
  return editor(page).evaluateHandle((element) => {
    let node: Element | null = element;
    while (
      node &&
      !(
        node.scrollHeight > node.clientHeight &&
        /auto|scroll/.test(getComputedStyle(node).overflowY)
      )
    ) {
      node = node.parentElement;
    }
    return node ?? document.scrollingElement!;
  });
}

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
  // Until all of it is drawn: a long shard's later parts follow its first.
  await editor(page)
    .getByText("The end.")
    .waitFor({ state: "attached", timeout: 60_000 });
  const openMs = Date.now() - openStarted;

  const scroller = await editorScroller(page);
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

test("an outside save that drops saved typing asks which to keep", async ({ page }) => {
  await mockVault(page, {
    files: { "Note.md": "# Note\n\nFirst.\n\nSecond.\n" },
    open: "Note.md",
  });
  await caretAfter(page, "First.");
  await page.keyboard.type(" Typed.");
  await expect
    .poll(() => lastSave(page, "Note.md"))
    .toBe("# Note\n\nFirst. Typed.\n\nSecond.\n");

  // An app that still had the old text saves it with its own change.
  await changeOutside(page, "Note.md", "# Note\n\nFirst.\n\nSecond, from elsewhere.\n");

  await expect(page.getByText("Choose which version to keep")).toBeVisible();
  await expect(page.locator(".history-added", { hasText: "Typed" })).toBeVisible();
  await expect(editor(page)).toContainText("First. Typed.");
  await page.screenshot({ path: "test-results/outside-change-dialog.png" });

  await page.getByRole("button", { name: "Keep your version" }).click();
  await expect
    .poll(() => lastSave(page, "Note.md"))
    .toBe("# Note\n\nFirst. Typed.\n\nSecond.\n");
});

test("deleting the text under the cursor outside keeps the scroll", async ({ page }) => {
  const body = Array.from({ length: 200 }, (_, i) => `Paragraph ${i}.`).join("\n\n");
  await mockVault(page, {
    files: { "Long.md": `# Long\n\n${body}\n\nThe end.\n` },
    open: "Long.md",
  });
  await caretAfter(page, "The end.");

  const scroller = await editorScroller(page);
  await scroller.evaluate((element: Element) => {
    element.scrollTop = 0;
  });

  await changeOutside(page, "Long.md", `# Long\n\n${body}\n`);
  await expect(editor(page).getByText("The end.")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await scroller.evaluate((element: Element) => element.scrollTop)).toBe(0);
});
