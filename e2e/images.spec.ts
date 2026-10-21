import { editor, expect, mockVault, test } from "./vault";

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
