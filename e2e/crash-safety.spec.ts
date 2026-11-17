import type { Page } from "@playwright/test";
import {
  caretAfter,
  editor,
  expect,
  lastSave,
  mockVault,
  openShard,
  test,
  VAULT_PATH,
} from "./vault";

// The blocks that fail to draw and the editor crash come from the test kit
// in builds for these tests (src/components/editor/kits/crash-test-kit.tsx).
const CRASH_EDITOR_EVENT = "netherstone:crash-editor";

test("a block that fails to draw leaves the rest of the shard working", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // A cached tree with a block that throws as it draws.
  await page.addInitScript((vaultPath) => {
    window.__overrides = {
      open_markdown_file: () => ({
        file_path: `${vaultPath}/Broken.md`,
        markdown: "First line\n\nBroken block\n\nLast line\n",
        content_hash: "hash-broken",
        cache_hit: true,
        plate_value: [
          { type: "p", children: [{ text: "First line" }] },
          { type: "p", failsToDraw: true, children: [{ text: "Broken block" }] },
          { type: "p", children: [{ text: "Last line" }] },
        ],
      }),
    };
  }, VAULT_PATH);
  await mockVault(page, {
    files: { "Broken.md": "First line\n\nBroken block\n\nLast line\n" },
    open: "Broken.md",
  });

  const notice = editor(page).locator("[data-block-error]");
  await expect(notice).toHaveText("This block couldn't be shown");
  await expect(editor(page)).toContainText("First line");
  expect(errors.some((error) => error.includes("A block couldn't be shown (p)"))).toBe(true);

  await caretAfter(page, "Last line");
  await page.keyboard.type(" and more");

  expect(await lastSave(page, "Broken.md")).toBe(
    "First line\n\nBroken block\n\nLast line and more\n",
  );
  await expect(notice).toBeVisible();

  // The caret and a selection move across it, and the editor keeps working.
  await caretAfter(page, "First line");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await caretAfter(page, "First line");
  await page.keyboard.type("!");
  await expect(editor(page)).toContainText("First line!");
  await expect(page.getByText("The editor ran into an error.")).toHaveCount(0);
});

test.describe("an editor crash", () => {
  const shard = `${VAULT_PATH}/Note.md`;

  test.beforeEach(async ({ page }) => {
    // Saves fail until a test lets them through, so the typing stays unsaved.
    await page.addInitScript(() => {
      window.__overrides = {
        save_markdown_file: () => Promise.reject(new Error("Saving is held")),
      };
    });
    await mockVault(page, {
      files: { "Note.md": "Saved text\n", "Other.md": "Other text\n" },
      open: "Note.md",
    });
    await caretAfter(page, "Saved text");
    await page.keyboard.type(" plus typed");
    await page.waitForFunction(() =>
      window.__commands.some(({ command }) => command === "save_markdown_file"),
    );

    await page.evaluate((event) => window.dispatchEvent(new Event(event)), CRASH_EDITOR_EVENT);
    await expect(page.getByText("The editor ran into an error.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore unsaved edits" })).toBeVisible();

    const kept = await page.evaluate((path) => window.__keptEdits[path], shard);
    expect(JSON.parse(kept)).toEqual({ markdown: "Saved text plus typed\n" });
    expect(await page.evaluate(() => window.__vaultFiles["Note.md"])).toBe("Saved text\n");
  });

  test("keeps unsaved edits to restore and save", async ({ page }) => {
    await page.evaluate(() => delete window.__overrides);
    await page.getByRole("button", { name: "Restore unsaved edits" }).click();

    await expect(editor(page)).toContainText("Saved text plus typed");
    expect(await lastSave(page, "Note.md")).toBe("Saved text plus typed\n");
    await page.waitForFunction((path) => !(path in window.__keptEdits), shard);
  });

  test("drops kept edits when the saved version is reloaded", async ({ page }) => {
    await page.getByRole("button", { name: "Reload shard" }).click();

    await expect(editor(page)).toHaveText("Saved text");
    expect(await page.evaluate((path) => path in window.__keptEdits, shard)).toBe(false);
    expect(await page.evaluate(() => window.__vaultFiles["Note.md"])).toBe("Saved text\n");
  });

  test.describe("after switching to another shard", () => {
    const offer = (page: Page) => page.getByText("Unsaved edits to Note were kept");

    test.beforeEach(async ({ page }) => {
      await openShard(page, "Other");
      await expect(editor(page)).toHaveText("Other text");
      await openShard(page, "Note");
      await expect(offer(page)).toBeVisible();
      await expect(editor(page)).toHaveText("Saved text");
    });

    test("offers the kept edits again to restore and save", async ({ page }) => {
      await page.evaluate(() => delete window.__overrides);
      await page.getByRole("button", { name: "Restore unsaved edits" }).click();

      await expect(editor(page)).toContainText("Saved text plus typed");
      await expect(offer(page)).toHaveCount(0);
      expect(await lastSave(page, "Note.md")).toBe("Saved text plus typed\n");
      await page.waitForFunction((path) => !(path in window.__keptEdits), shard);
    });

    test("discards the kept edits and doesn't offer them again", async ({ page }) => {
      await page.getByRole("button", { name: "Discard" }).click();

      await expect(offer(page)).toHaveCount(0);
      await page.waitForFunction((path) => !(path in window.__keptEdits), shard);
      await expect(editor(page)).toHaveText("Saved text");
      expect(await page.evaluate(() => window.__vaultFiles["Note.md"])).toBe("Saved text\n");

      const reads = await readsOf(page, shard);
      await openShard(page, "Other");
      await openShard(page, "Note");
      await expect(editor(page)).toHaveText("Saved text");
      await expectNoOffer(page, shard, reads);
    });
  });
});

/** How many times the app looked for kept edits of `filePath`. */
function readsOf(page: Page, filePath: string) {
  return page.evaluate(
    (filePath) =>
      window.__commands.filter(
        ({ command, args }) =>
          command === "read_unsaved_edits" && (args as { filePath: string }).filePath === filePath,
      ).length,
    filePath,
  );
}

/** Waits for one more look for kept edits of `filePath`, then checks no offer shows. */
async function expectNoOffer(page: Page, filePath: string, readsBefore: number) {
  await expect.poll(() => readsOf(page, filePath)).toBeGreaterThan(readsBefore);
  // The look and the offer it leads to run as promise callbacks of the task
  // that logged the look, and the offer draws as it's made, so it's on the
  // page by the time a test sees the look.
  await expect(page.getByText(/^Unsaved edits to .* were kept/)).toHaveCount(0);
}

test("a shard with no kept edits opens without an offer", async ({ page }) => {
  await mockVault(page, { files: { "Note.md": "Saved text\n" }, open: "Note.md" });
  await expect(editor(page)).toHaveText("Saved text");
  await expectNoOffer(page, `${VAULT_PATH}/Note.md`, 0);
});
