import { devices, type Page } from "@playwright/test";

import {
  ANDROID_PHONE,
  caretAfter,
  editor,
  expect,
  lastSave,
  mockVault,
  select,
  test,
} from "./vault";

// Editing on a phone, with the keyboard sent as MainActivity's `systeminsets`.
// Tablet-wide, so the desktop sidebars leave the shard room.
test.use({
  userAgent: ANDROID_PHONE,
  hasTouch: true,
  viewport: { width: 1024, height: 900 },
});

const KEYBOARD = 300;
/** A one-pixel PNG. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

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

test("the style panel stays up while picking a text color", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await typeAt(page, "Second line.");
  await select(page, "Second");

  await bar(page).getByRole("button", { name: "Text style" }).click();
  await panel(page).getByRole("radio", { name: "Text color" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(panel(page)).toBeVisible();
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

test("typing / or @ opens its menu", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  const blocks = editor(page).locator("[data-slate-node='element']");
  const count = await blocks.count();
  await typeAt(page, "Second line.");

  await page.keyboard.press("Enter");
  await expect(blocks).toHaveCount(count + 1);
  await page.keyboard.type("/quote");
  await page.getByRole("option", { name: "Blockquote" }).click();
  await page.keyboard.type("Quoted @Oth");
  await expect(page.getByRole("option", { name: "Other" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => lastSave(page, "Note.md")).toContain("> Quoted");
});

test("the / that opens the menu doesn't stay on screen", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  const blocks = editor(page).locator("[data-slate-node='element']");
  const count = await blocks.count();
  await typeAt(page, "Second line.");

  await page.keyboard.press("Enter");
  await expect(blocks).toHaveCount(count + 1);
  await page.keyboard.type("/voice");
  await page.getByRole("option", { name: "Voice note" }).click();
  // The line the menu was on stays, empty, under the voice note.
  await expect(page.getByRole("group", { name: "Voice note recording" })).toBeVisible();
  await expect(editor(page)).not.toContainText("/");
});

test("a voice note's problem stays readable on a narrow screen", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await typeAt(page, "Second line.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/voice");
  await page.getByRole("option", { name: "Voice note" }).click();

  const card = page.getByRole("group", { name: "Voice note recording" });
  const discard = card.getByRole("button", { name: "Discard" });
  await expect(discard).toBeVisible();
  // As wide as the shard is on a phone.
  await card.evaluate((element) => (element.style.width = "300px"));
  const cardBox = (await card.boundingBox())!;
  const words = (await card.getByRole("status").boundingBox())!;
  const button = (await discard.boundingBox())!;
  // The buttons go under the words instead of squeezing them or spilling out.
  expect(words.width).toBeGreaterThan(button.width);
  expect(button.x + button.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
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

test("a picture pasted on Android is added to the vault", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { isTauri: boolean }).isTauri = true;
  });
  await mockVault(page, { files: FILES, open: "Note.md" });
  await typeAt(page, "First line.");
  await page.keyboard.press("Enter");

  // As a keyboard's clipboard pastes it: a file in the paste's data.
  await editor(page).evaluate((element, base64) => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, PNG);

  await expect
    .poll(() => page.evaluate(() => window.__binaries["_attachments/pasted.png"]))
    .toBe(PNG);
  await expect.poll(() => lastSave(page, "Note.md")).toContain("_attachments/pasted.png");
});

test.describe("in the phone layout", () => {
  // The browser stays the file's own; only the phone's screen and touch.
  const { defaultBrowserType: _browser, ...phone } = devices["Pixel 7"];
  test.use(phone);

  /** What was last written for `name`: phones have no "Saved" in a top bar to wait for. */
  const written = (page: Page, name: string) =>
    page.evaluate(
      (name) => window.__saves.filter((save) => save.filePath.endsWith(`/${name}`)).at(-1)?.content,
      name,
    );

  test("a shard opened from home has the bar above the keyboard, and its links open", async ({
    page,
  }) => {
    await mockVault(page, { files: FILES, nested: true });
    await page
      .getByRole("region", { name: "Files" })
      .getByRole("button", { name: /^Note/ })
      .click();
    await typeAt(page, "First line.");
    await bar(page).getByRole("button", { name: "Bulleted list" }).click();
    await expect.poll(() => written(page, "Note.md")).toContain("- First line.");

    await bar(page).getByRole("button", { name: "Hide keyboard" }).click();
    await keyboard(page, 0);
    await editor(page).getByText("Other").click();
    await expect(page.getByText("Other body text.")).toBeVisible();
  });
});
