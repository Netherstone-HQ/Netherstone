import type { Locator } from "@playwright/test";

import { editor, expect, mockVault, test } from "./vault";

const FILES = {
  "Blocks.md": [
    "# Blocks",
    "",
    "## Heading",
    "",
    '<callout icon="💡">',
    "  Callout text",
    "</callout>",
    "",
    "<details open>",
    "<summary>Toggle summary</summary>",
    "",
    "Inside",
    "",
    "</details>",
    "",
    "| A | B |",
    "| - | - |",
    "| one | two |",
    "",
    "```",
    "code line",
    "```",
    "",
  ].join("\n"),
};

const middle = async (locator: Locator) => {
  const box = (await locator.boundingBox())!;
  return box.y + box.height / 2;
};

// The vertical middle of the first line of text in the block.
const firstLineMiddle = (block: Locator) =>
  block.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && (!node.textContent?.trim() || node.parentElement?.closest('[contenteditable="false"]'))) {
      node = walker.nextNode();
    }
    const range = document.createRange();
    range.setStart(node!, 0);
    range.setEnd(node!, 1);
    const rect = range.getClientRects()[0];
    return rect.top + rect.height / 2;
  });

const block = (text: string, page: import("@playwright/test").Page) =>
  editor(page).locator("div:has(> .slate-blockWrapper)").filter({ hasText: text }).first();

test("block handles sit on the first line of text, without moving into place", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Blocks.md" });
  await expect(editor(page).getByText("code line")).toBeVisible();

  for (const text of ["Heading", "Callout text", "Toggle summary", "one", "code line"]) {
    const target = block(text, page);
    await target.hover({ position: { x: 20, y: 4 } });
    const handle = target.locator(".slate-blockToolbar button");
    await expect(handle).toBeVisible();

    const transition = await handle.evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(transition).not.toMatch(/\b(all|top)\b/);
    expect(Math.abs((await middle(handle)) - (await firstLineMiddle(target)))).toBeLessThan(1.5);
  }
});

test("the callout emoji and toggle arrow sit on the first line", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Blocks.md" });
  await expect(editor(page).getByText("Callout text")).toBeVisible();

  for (const textSize of ["small", "large"]) {
    await page.evaluate((size) => document.documentElement.setAttribute("data-text-size", size), textSize);

    const callout = block("Callout text", page);
    const emoji = callout.locator(".font-emoji");
    expect(Math.abs((await middle(emoji)) - (await firstLineMiddle(callout)))).toBeLessThan(1.5);

    const toggle = block("Toggle summary", page);
    const arrow = toggle.locator("svg.lucide-chevron-right");
    expect(Math.abs((await middle(arrow)) - (await firstLineMiddle(toggle)))).toBeLessThan(1.5);
  }
});
