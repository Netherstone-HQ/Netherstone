import type { Page } from "@playwright/test";

import { caretAfter, editor, expect, mockVault, test } from "./vault";

/** The composer's model button: one row, all on one center line. */

const FILES = { "Trip.md": "# Trip\n\nLisbon in May, by train.\n" };

const READY = { provider: true, vaultAllowed: true, picked: true };

async function selectLisbon(page: Page) {
  await caretAfter(page, "by train");
  await editor(page).evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const at = node.data.indexOf("Lisbon in May");
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + "Lisbon in May".length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
  });
}

test("centers the model's name, dot, provider and chevron on one line", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const button = page
    .getByRole("complementary", { name: "Assistant" })
    .getByRole("button", { name: "Model" });
  await expect(button).toHaveText(/Claude Sonnet 5\.5\s*Anthropic/);

  const centers = await button.evaluate((element) => {
    const middle = (rect: DOMRect) => rect.top + rect.height / 2;
    const text = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return middle(range.getBoundingClientRect());
    };
    const [name, , provider] = [...element.children];
    const dot = element.querySelector(".rounded-full");
    const chevron = element.querySelector("svg");
    if (!dot || !chevron) throw new Error("No dot or chevron");
    return {
      button: middle(element.getBoundingClientRect()),
      name: text(name),
      dot: middle(dot.getBoundingClientRect()),
      provider: text(provider),
      chevron: middle(chevron.getBoundingClientRect()),
    };
  });
  for (const center of Object.values(centers)) {
    expect(Math.abs(center - centers.button)).toBeLessThanOrEqual(0.5);
  }
});

test("picks how much a thinking model thinks, next to the model", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const panel = page.getByRole("complementary", { name: "Assistant" });
  const thinking = panel.getByRole("button", { name: "Thinking: Low" });
  await expect(thinking).toHaveText("Low");

  await thinking.click();
  await expect(page.getByRole("menu").getByText("Thinking", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: /^Low/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("menuitemradio", { name: /^Medium/ }).click();
  await expect(panel.getByRole("button", { name: "Thinking: Medium" })).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);

  await panel.getByRole("button", { name: "Thinking: Medium" }).click();
  await expect(page.getByRole("menuitemradio", { name: /^Medium/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");

  // Same line as the model, with the composer's own gap before Send.
  const box = async (name: string) =>
    (await panel.getByRole("button", { name }).boundingBox())!;
  const [model, button, send] = await Promise.all([
    box("Model"),
    box("Thinking: Medium"),
    box("Send"),
  ]);
  const middle = (b: { y: number; height: number }) => b.y + b.height / 2;
  expect(Math.abs(middle(button) - middle(model))).toBeLessThanOrEqual(0.5);
  expect(button.x).toBeGreaterThanOrEqual(model.x + model.width);
  expect(send.x - (button.x + button.width)).toBeGreaterThanOrEqual(8);
});

test("has no thinking control for a model that doesn't think", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, thinking: null },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const panel = page.getByRole("complementary", { name: "Assistant" });
  await expect(panel.getByRole("button", { name: "Model" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Thinking/ })).toHaveCount(0);
});

test("shows the same thinking control in inline Ask, before Send", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await selectLisbon(page);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const button = (await page.getByRole("button", { name: "Thinking: Low" }).boundingBox())!;
  const send = (await page.getByRole("button", { name: "Send" }).boundingBox())!;
  expect(send.x - (button.x + button.width)).toBeGreaterThanOrEqual(8);
});

test("puts the cursor back in the message after picking a model or thinking", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const panel = page.getByRole("complementary", { name: "Assistant" });
  const message = panel.getByRole("textbox");

  await panel.getByRole("button", { name: "Thinking: Low" }).click();
  await page.getByRole("menuitemradio", { name: /^Medium/ }).click();
  await expect(panel.getByRole("button", { name: "Thinking: Medium" })).toBeVisible();
  await expect(message).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  await panel.getByRole("button", { name: "Model" }).click();
  await page.getByRole("option", { name: "Claude Sonnet 5.5" }).click();
  await expect(message).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("puts the cursor back in inline Ask after picking a model or thinking", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await selectLisbon(page);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const ask = page.getByRole("textbox", { name: "Ask about the selection" });
  await expect(ask).toBeFocused();

  await page.getByRole("button", { name: "Thinking: Low" }).click();
  await page.getByRole("menuitemradio", { name: /^High/ }).click();
  await expect(page.getByRole("button", { name: "Thinking: High" })).toBeVisible();
  await expect(ask).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  await page.getByRole("button", { name: "Model" }).click();
  await page.getByRole("option", { name: "Claude Sonnet 5.5" }).click();
  await expect(ask).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("Escape in inline Ask's thinking menu closes only the menu", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await selectLisbon(page);
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  await page.getByRole("button", { name: "Thinking: Low" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Ask about the selection" })).toBeVisible();
});
