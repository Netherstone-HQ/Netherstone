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
      files: { "Media.md": "![Old stone](_attachments/stone.png)\n\nAfter.\n" },
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

    // Tab leaves it, and it shows as text again.
    await page.keyboard.press("Tab");
    await expect(textarea).toHaveCount(0);
    await expect(caption).toHaveText("Older stone");

    await caretAfter(page, "After.");
    // Each typed letter is its own step back.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(caption).toHaveText("Olde stone");
  });

  test("takes focus from Tab and keeps the text", async ({ page }) => {
    const caption = editor(page).locator("figcaption");
    await caption.locator("div").focus();
    const textarea = caption.locator("textarea");
    await expect(textarea).toBeFocused();
    await expect(textarea).toHaveValue("Old stone");
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
