import { caretAfter, editor, expect, lastSave, mockVault, test } from "./vault";

// A 1×1 PNG, drawn as wide as the text column.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

test("a full-width picture keeps its grips inside the text column and can be resized", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { isTauri: boolean }).isTauri = true;
  });
  await mockVault(page, {
    files: { "Media.md": "# Media\n\n![Stone](_attachments/stone.png)\n\nAfter.\n" },
    assets: { "_attachments/stone.png": PNG },
    open: "Media.md",
  });

  const figure = editor(page).locator("figure");
  const image = figure.locator("img");
  await expect(image).toHaveJSProperty("naturalWidth", 1);
  const column = await editor(page).evaluate((root) => {
    const box = root.getBoundingClientRect();
    const style = getComputedStyle(root);
    return {
      left: box.left + parseFloat(style.paddingLeft),
      right: box.right - parseFloat(style.paddingRight),
    };
  });
  const before = (await image.boundingBox())!;
  expect(Math.round(before.width)).toBe(Math.round(column.right - column.left));

  await figure.hover();
  const grips = figure.locator(".cursor-col-resize");
  for (const index of [0, 1]) {
    const box = (await grips.nth(index).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(column.left - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(column.right + 0.5);
  }

  // The left grip is not covered by the block's drag handle.
  const grip = (await grips.first().boundingBox())!;
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 5 });
  await page.mouse.up();

  await expect
    .poll(async () => (await image.boundingBox())!.width)
    .toBeLessThan(before.width - 100);
});

test.describe("a picture's caption", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { isTauri: boolean }).isTauri = true;
    });
    await mockVault(page, {
      files: {
        "Media.md":
          "Before.\n\n![Old stone](_attachments/stone.png)\n\nAfter.\n\n![](_attachments/stone.png)\n\nEnd.\n",
      },
      assets: { "_attachments/stone.png": PNG },
      open: "Media.md",
      versions: {
        "Media.md": [
          {
            time: Math.floor(Date.now() / 1000) - 3600,
            content: "![First stone](_attachments/stone.png)\n",
            kind: "created",
          },
        ],
      },
    });
  });

  test("shows as text and is edited where it's clicked", async ({ page }) => {
    const caption = editor(page).locator("figcaption");
    await expect(caption).toHaveText("Old stone");
    await expect(caption.locator("textarea")).toHaveCount(0);

    await caption.scrollIntoViewIfNeeded();
    const afterOld = await caption.evaluate((figcaption) => {
      const text = figcaption.querySelector("div")!.firstChild!;
      const range = document.createRange();
      range.setStart(text, 3);
      range.setEnd(text, 3);
      const rect = range.getBoundingClientRect();
      return { x: rect.x, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(afterOld.x, afterOld.y);
    const textarea = caption.locator("textarea");
    await expect(textarea).toBeFocused();
    await page.keyboard.type("er");
    await expect(textarea).toHaveValue("Older stone");
    expect(await lastSave(page, "Media.md")).toContain("Older stone");

    // Tab leaves it, and once the pointer is away it shows as text again.
    await page.keyboard.press("Tab");
    await page.mouse.move(0, 0);
    await expect(textarea).toHaveCount(0);
    await expect(caption).toHaveText("Older stone");

    await caretAfter(page, "After.");
    // Each typed letter is its own step back.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(caption).toHaveText("Olde stone");
  });

  test("selects a word on double click and text by dragging, and keeps its height", async ({
    page,
  }) => {
    const caption = editor(page).locator("figcaption");
    await caption.scrollIntoViewIfNeeded();
    const asText = (await caption.boundingBox())!;

    // "stone" in "Old stone".
    const word = await caption.evaluate((figcaption) => {
      const text = figcaption.querySelector("div")!.firstChild!;
      const range = document.createRange();
      range.setStart(text, 4);
      range.setEnd(text, 9);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right, y: rect.y + rect.height / 2 };
    });
    await page.mouse.dblclick((word.left + word.right) / 2, word.y);
    const textarea = caption.locator("textarea");
    await expect(textarea).toBeFocused();
    const selected = () =>
      textarea.evaluate((box: HTMLTextAreaElement) => [box.selectionStart, box.selectionEnd]);
    expect(await selected()).toEqual([4, 9]);

    // As a textarea, the caption sits where the text did.
    const asTextarea = (await caption.boundingBox())!;
    expect(Math.abs(asTextarea.y - asText.y)).toBeLessThan(1);
    expect(Math.abs(asTextarea.height - asText.height)).toBeLessThan(1);

    await page.keyboard.press("Tab");
    await page.mouse.move(word.left + 1, word.y);
    await page.mouse.down();
    await page.mouse.move(word.right - 1, word.y, { steps: 5 });
    await page.mouse.up();
    await expect(textarea).toBeFocused();
    expect(await selected()).toEqual([4, 9]);
  });

  test("takes focus from Tab, and Down goes on to the next block", async ({ page }) => {
    const caption = editor(page).locator("figcaption");
    await caption.locator("div").focus();
    const textarea = caption.locator("textarea");
    await expect(textarea).toBeFocused();
    await expect(textarea).toHaveValue("Old stone");

    await page.keyboard.press("ArrowDown");
    await expect(textarea).toHaveCount(0);
    await page.keyboard.type("Then ");
    await expect(editor(page)).toContainText("Then After.");
  });

  test("Up goes into it from the next block, and Up again selects the picture", async ({
    page,
  }) => {
    const caption = editor(page).locator("figcaption");
    // Into the caption and Down out of it, which leaves the caret at the
    // start of the next block by the editor's own selection.
    await caption.locator("div").focus();
    await page.keyboard.press("ArrowDown");
    await expect(editor(page)).toBeFocused();
    // Held as a person holds it: Plate checks for Up while the caret moves,
    // which can be after an instant release.
    await page.keyboard.down("ArrowUp");
    const textarea = caption.locator("textarea");
    await expect(textarea).toBeFocused();
    await page.keyboard.up("ArrowUp");

    await page.keyboard.press("ArrowUp");
    await expect(textarea).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Caption" })).toBeVisible();
  });

  test("Down from a selected picture goes into its caption", async ({ page }) => {
    const figure = editor(page).locator("figure").first();
    await figure.locator("img").click();
    await expect(page.getByRole("button", { name: "Caption" })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(figure.locator("textarea")).toBeFocused();
    await expect(figure.locator("textarea")).toHaveValue("Old stone");
  });

  test("the Caption button puts the caret in it, with text or without", async ({ page }) => {
    const [first, last] = [
      editor(page).locator("figure").first(),
      editor(page).locator("figure").last(),
    ];
    await first.locator("img").click();
    await page.getByRole("button", { name: "Caption" }).click();
    await expect(first.locator("textarea")).toBeFocused();
    await expect(first.locator("textarea")).toHaveValue("Old stone");

    await expect(last.locator("figcaption")).toHaveCount(0);
    await caretAfter(page, "End.");
    await last.locator("img").click();
    // The first picture's toolbar fades out first.
    await expect(page.getByRole("button", { name: "Caption" })).toHaveCount(1);
    await page.getByRole("button", { name: "Caption" }).click();
    const empty = last.locator("textarea");
    await expect(empty).toBeFocused();
    await expect(empty).toHaveAttribute("placeholder", "Write a caption...");
    await page.keyboard.type("New stone");
    await page.keyboard.press("Tab");
    await expect(last.locator("figcaption")).toHaveText("New stone");
  });

  test("an emptied caption goes away when it's left", async ({ page }) => {
    const figure = editor(page).locator("figure").first();
    await figure.locator("figcaption div").focus();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await page.keyboard.press("Tab");
    await expect(figure.locator("figcaption")).toHaveCount(0);
    expect(await lastSave(page, "Media.md")).not.toContain("Old stone");
  });

  test("shows as text in a read-only view and stays text when clicked", async ({ page }) => {
    await page.getByRole("button", { name: "Show history" }).click();
    await page
      .getByRole("complementary", { name: "History" })
      .getByText("Created")
      .click();

    const caption = page
      .getByLabel("Earlier version")
      .locator("figcaption", { hasText: "First stone" });
    await expect(caption).toBeVisible();
    await caption.click();
    await expect(caption.locator("textarea")).toHaveCount(0);
  });
});
