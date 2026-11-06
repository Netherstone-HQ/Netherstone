import type { Page } from "@playwright/test";

import { caretAfter, editor, expect, mockVault, test } from "./vault";

/**
 * Inline Ask in the text toolbar: a prompt under the selection, the answer
 * previewed in place, then applied as an edit or discarded.
 */

const WHY =
  "Because everything lives on your own computer, the app keeps working when you lose your connection.";
const FILES = { "Why.md": `# Why local-first\n\n${WHY}\n\nSearch runs locally too.\n` };

const READY = {
  provider: true,
  vaultAllowed: true,
  picked: true,
  inline: ["it works ", "offline"],
};

/** Selects `text` in the shard, as a drag over it would. */
async function select(page: Page, text: string) {
  await caretAfter(page, text);
  await editor(page).evaluate((root, wanted) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const at = node.data.indexOf(wanted);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
  }, text);
}

/** The toolbar that shows over selected text. */
const textToolbar = (page: Page) => page.locator("[role=toolbar].bg-popover");

const prompt = (page: Page) => page.getByRole("textbox", { name: "Ask about the selection" });

async function shardSaves(page: Page) {
  return (await page.evaluate(() => window.__saves)).filter((save) =>
    save.filePath.endsWith(".md"),
  );
}

test("has no Ask while the assistant is off", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Why.md" });
  await select(page, "the app keeps working");
  await expect(textToolbar(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toHaveCount(0);
});

test("changes part of a paragraph in place, and Undo puts it back", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Why.md", assistant: READY });
  await select(page, "the app keeps working when you lose your connection");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(prompt(page)).toBeFocused();
  await prompt(page).fill("Make it shorter");
  await prompt(page).press("Enter");

  // The preview: what goes struck through, what comes in after it.
  const removed = editor(page).locator("del.history-removed");
  await expect(removed).toHaveText("the app keeps working when you lose your connection");
  await expect(editor(page).locator(".history-added")).toHaveText("it works offline");
  expect(await page.evaluate(() => window.__asked)).toEqual([
    {
      shard: "Why.md",
      selection: expect.stringContaining("the app keeps working"),
      whole: false,
      prompt: "Make it shorter",
    },
  ]);

  await page.getByRole("button", { name: "Apply" }).click();
  await expect(editor(page)).toContainText(
    "Because everything lives on your own computer, it works offline.",
  );
  await expect(removed).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor(page)).toContainText(WHY);
});

test("changes a whole paragraph as blocks, and Discard keeps it", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Why.md",
    assistant: { ...READY, inline: ["Everything is on your computer, so it works offline."] },
  });
  await select(page, WHY);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await prompt(page).fill("Make it shorter");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(editor(page).locator('[data-history-block="removed"]')).toContainText(WHY);
  const added = page.getByLabel("Change to the selection");
  await expect(added.locator('[data-history-block="added"]')).toHaveText(
    "Everything is on your computer, so it works offline.",
  );
  expect((await page.evaluate(() => window.__asked))[0].whole).toBe(true);

  await page.getByRole("button", { name: "Discard" }).click();
  await expect(added).toHaveCount(0);
  await expect(editor(page).locator('[data-history-block="removed"]')).toHaveCount(0);
  await expect(editor(page)).toContainText(WHY);
  expect(await shardSaves(page)).toEqual([]);
});

test("Escape closes the prompt, and Stop leaves the text as it was", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Why.md",
    assistant: { ...READY, holdInline: true },
  });
  await select(page, "the app keeps working");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await prompt(page).press("Escape");
  await expect(prompt(page)).toHaveCount(0);

  await select(page, "the app keeps working");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await prompt(page).fill("Make it shorter");
  await prompt(page).press("Enter");
  await expect(page.getByText("Waiting for the answer")).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Waiting for the answer")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.__commands.filter((c) => c.command === "assistant_stop").length,
    ),
  ).toBe(1);
  await expect(editor(page)).toContainText(WHY);
});

test("turning the assistant off leaves nothing behind", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Why.md", assistant: READY });
  await select(page, "the app keeps working when you lose your connection");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await prompt(page).fill("Make it shorter");
  await prompt(page).press("Enter");
  await expect(page.getByRole("button", { name: "Apply" })).toBeVisible();

  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  await page.getByRole("button", { name: "AI assistant" }).click();
  await page.getByRole("switch", { name: "Turn on the assistant" }).click();
  await expect(page.getByRole("switch", { name: "Turn on the assistant" })).not.toBeChecked();
  await settings.click();

  // No preview, no prompt, no tint, no Ask, and the shard as it was.
  await expect(editor(page)).toContainText(WHY);
  await expect(editor(page).locator(".history-removed, .history-added")).toHaveCount(0);
  await expect(editor(page).locator(".bg-brand\\/25")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);
  expect(await shardSaves(page)).toEqual([]);
  await select(page, "the app keeps working");
  await expect(textToolbar(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toHaveCount(0);
});
