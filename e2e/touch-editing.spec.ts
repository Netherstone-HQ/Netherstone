import type { Page } from "@playwright/test";

import {
  caretAfter,
  editor,
  expect,
  lastSave,
  mockVault,
  select,
  test,
} from "./vault";

/**
 * Editing on a phone: the bar above the keyboard, the style panel in the
 * keyboard's place, the long-press block menu and links that open on tap.
 * The page reports an Android phone; the keyboard is what the app's
 * MainActivity reports, sent here as its `systeminsets` event. The window is
 * tablet-wide so the desktop sidebars leave the shard room.
 */
test.use({
  userAgent:
    "Mozilla/5.0 (Linux; Android 15; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
  hasTouch: true,
  viewport: { width: 1024, height: 900 },
});

const KEYBOARD = 300;

const FILES = {
  "Note.md":
    "# Note\n\nFirst line.\n\nSecond line.\n\nSee [Other](Other.md) here.\n",
  "Other.md": "# Other\n\nOther body text.\n",
};

const bar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });
const panel = (page: Page) => page.getByRole("group", { name: "Text style" });

/** The keyboard going up or down, as the app reports it. */
async function keyboard(page: Page, height: number) {
  await page.evaluate((keyboard) => {
    window.dispatchEvent(
      new CustomEvent("systeminsets", {
        detail: { keyboard, top: 24, bottom: keyboard ? 0 : 24 },
      }),
    );
  }, height);
}

/** Starts typing at the end of `text`, with the keyboard up. */
async function typeAt(page: Page, text: string) {
  await caretAfter(page, text);
  await keyboard(page, KEYBOARD);
  await expect(bar(page)).toBeVisible();
}

/** A long press on the block holding `text`, as Android reports it. */
async function longPress(page: Page, text: string) {
  const block = editor(page)
    .locator("[data-slate-node='element']")
    .filter({ hasText: text })
    .last();
  await block.dispatchEvent("contextmenu", { bubbles: true, cancelable: true });
}

test("the desktop toolbars give way to the bar above the keyboard", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, open: "Note.md" });

  await expect(page.getByRole("button", { name: "More" })).toHaveCount(0);
  await caretAfter(page, "First line.");
  await expect(bar(page)).toBeHidden();

  await keyboard(page, KEYBOARD);
  await expect(bar(page)).toBeVisible();
  await expect(page.locator("html")).toHaveCSS(
    "--keyboard-inset",
    `${KEYBOARD}px`,
  );
  await expect(page.locator("html")).toHaveCSS("--safe-area-bottom", "0px");

  await keyboard(page, 0);
  await expect(bar(page)).toBeHidden();
  await expect(page.locator("html")).toHaveCSS("--safe-area-bottom", "24px");
});

test("the bar's buttons keep the caret and change the text", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await typeAt(page, "First line.");

  await bar(page).getByRole("button", { name: "Bulleted list" }).click();
  await expect(editor(page)).toBeFocused();
  await expect.poll(() => lastSave(page, "Note.md")).toContain("- First line.");

  await bar(page).getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => lastSave(page, "Note.md")).toContain("\nFirst line.");

  await bar(page).getByRole("button", { name: "Insert" }).click();
  await page
    .getByRole("dialog", { name: "Insert" })
    .getByRole("button", { name: "Divider" })
    .click();
  await expect.poll(() => lastSave(page, "Note.md")).toContain("---");
});

test("Hide keyboard leaves the shard", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await typeAt(page, "First line.");

  await bar(page).getByRole("button", { name: "Hide keyboard" }).click();
  await expect(editor(page)).not.toBeFocused();
});

test("Text style swaps the keyboard for the style panel", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await typeAt(page, "Second line.");

  await bar(page).getByRole("button", { name: "Text style" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(editor(page)).toHaveAttribute("inputmode", "none");
  await expect(editor(page)).toBeFocused();
  await keyboard(page, 0);
  await expect(panel(page)).toBeVisible();
  // As tall as the keyboard was.
  expect((await panel(page).boundingBox())?.height).toBe(KEYBOARD);

  await panel(page).getByRole("button", { name: "H2" }).click();
  await expect
    .poll(() => lastSave(page, "Note.md"))
    .toContain("## Second line.");
  await expect(panel(page).getByRole("button", { name: "H2" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await bar(page).getByRole("button", { name: "Text style" }).click();
  await expect(panel(page)).toBeHidden();
  await expect(editor(page)).not.toHaveAttribute("inputmode", "none");
  await expect(editor(page)).toBeFocused();
});

test("the style panel marks selected text", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await typeAt(page, "Second line.");
  await select(page, "Second");

  await bar(page).getByRole("button", { name: "Text style" }).click();
  await panel(page).getByRole("button", { name: "Bold" }).click();
  await expect
    .poll(() => lastSave(page, "Note.md"))
    .toContain("**Second** line.");
});

test("a long press on a block opens its menu while the keyboard is down", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, open: "Note.md" });

  await longPress(page, "First line.");
  const sheet = page.getByRole("dialog", { name: "Paragraph" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Move down" }).click();
  await expect(sheet).toBeHidden();
  await expect
    .poll(() => lastSave(page, "Note.md"))
    .toContain("Second line.\n\nFirst line.");

  await longPress(page, "First line.");
  await page
    .getByRole("dialog", { name: "Paragraph" })
    .getByRole("button", { name: "Turn into" })
    .click();
  await page
    .getByRole("dialog", { name: "Paragraph" })
    .getByRole("button", { name: "Quote" })
    .click();
  await expect.poll(() => lastSave(page, "Note.md")).toContain("> First line.");

  await longPress(page, "First line.");
  await page
    .getByRole("dialog", { name: "Quote" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect
    .poll(() => lastSave(page, "Note.md"))
    .not.toContain("First line.");
});

test("while typing, a long press is left to the system", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await typeAt(page, "First line.");

  await longPress(page, "Second line.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a tap on a link opens it", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });

  await editor(page).getByText("Other").click();
  await expect(page.getByText("Other body text.")).toBeVisible();
});

test("a keyboard correction aimed outside the editor replaces the typed word", async ({
  page,
}) => {
  await mockVault(page, {
    files: { "Note.md": "# Note\n\nThis is rathe\n" },
    open: "Note.md",
  });
  await caretAfter(page, "This is rathe");

  // Gboard can send a correction whose target is outside the editor.
  await editor(page).evaluate((root) => {
    const outside = document.createElement("p");
    const range = document.createRange();
    range.setStart(outside, 0);
    const event = new InputEvent("beforeinput", {
      inputType: "insertText",
      data: "rather ",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "getTargetRanges", { value: () => [range] });
    root.dispatchEvent(event);
  });

  await expect.poll(() => lastSave(page, "Note.md")).toContain("This is rather");
  expect(await lastSave(page, "Note.md")).not.toContain("ratherather");
});
