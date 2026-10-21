import { editor, expect, mockVault, test } from "./vault";

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

const SHARD =
  '# Plan\n\n<img src="_attachments/Plan.png" data-dark-src="_attachments/Plan-dark.png" alt="Plan" width="480" data-excalidraw="Plan.excalidraw" />\n';

for (const theme of ["light", "dark"] as const) {
  test(`a drawing's image follows the ${theme} theme`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { isTauri: boolean }).isTauri = true;
    });
    await mockVault(page, {
      files: { "Plan.md": SHARD },
      assets: {
        "_attachments/Plan.png": PNG,
        "_attachments/Plan-dark.png": PNG,
      },
      open: "Plan.md",
      theme,
    });

    const image = editor(page).locator("figure img");
    await expect(image).toHaveJSProperty("naturalWidth", 1);
    const src = await image.getAttribute("src");
    expect(src).toContain(theme === "dark" ? "Plan-dark.png" : "Plan.png");
    if (theme === "light") expect(src).not.toContain("Plan-dark.png");
  });
}
