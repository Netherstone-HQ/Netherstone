import type { Page } from "@playwright/test";
import { caretAfter, editor, expect, mockVault, savesFor, test } from "./vault";

const FIRST = "# First\n\nFirst body text\n\nGo to [Second](Second.md)\n";
const SECOND = "# Second\n\nSecond body text\n";

declare global {
  interface Window {
    __openSecond?: () => void;
  }
}

/**
 * Holds the parse of Second until `__openSecond()` runs: the previous shard
 * stays on screen, dimmed, until then.
 */
async function holdSecond(page: Page) {
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    const held: [Worker, unknown][] = [];
    Worker.prototype.postMessage = function (this: Worker, message: unknown) {
      const request = message as { type?: string; markdown?: string };
      if (request.type === "deserialize" && request.markdown?.includes("Second body text")) {
        held.push([this, message]);
        return;
      }
      send.call(this, message);
    };
    window.__openSecond = () => {
      Worker.prototype.postMessage = send;
      for (const [worker, message] of held) send.call(worker, message);
    };
  });
}

const firstText = (page: Page) => page.getByText("First body text", { exact: true });

test("the previous shard can't be edited while the next one opens", async ({ page }) => {
  await mockVault(page, { files: { "First.md": FIRST, "Second.md": SECOND }, open: "First.md" });
  await caretAfter(page, "First body text");
  await holdSecond(page);

  await page.getByText("Second", { exact: true }).first().click();
  await expect(page.locator("div.opacity-60")).toBeVisible();

  // A click doesn't put the caret in it, so typing goes nowhere.
  await firstText(page).click();
  await expect(editor(page)).not.toBeFocused();
  await page.keyboard.type("lost");
  await expect(firstText(page)).toBeVisible();

  await page.evaluate(() => window.__openSecond?.());
  await expect(page.getByText("Second body text")).toBeVisible();
  await expect(firstText(page)).toBeHidden();
  expect(await savesFor(page, "First.md")).toEqual([]);
});

test("a link that opens another shard takes the caret out of this one", async ({ page }) => {
  await mockVault(page, { files: { "First.md": FIRST, "Second.md": SECOND }, open: "First.md" });
  await caretAfter(page, "First body text");
  await holdSecond(page);

  await editor(page).getByText("Second").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator("div.opacity-60")).toBeVisible();
  await expect(editor(page)).not.toBeFocused();
  await page.keyboard.type("lost");

  await page.evaluate(() => window.__openSecond?.());
  await expect(page.getByText("Second body text")).toBeVisible();
  expect(await savesFor(page, "First.md")).toEqual([]);
});
