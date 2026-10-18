import { expect, test } from "@playwright/test";
import { caretAfter, editor, lastSave, mockVault } from "./vault";

const NOTE = `# Formatting

<div align="center" style="line-height: 2">

Centred and spaced.

</div>

<img src="attachments/a.png" alt="A photo" width="320" />

Plain [link](https://example.com "Example") after.
`;

test("alignment, line height and image width come back from the file, and the wrapper is hidden", async ({
  page,
}) => {
  await mockVault(page, { files: { "Formatting.md": NOTE }, open: "Formatting.md" });

  const centred = editor(page).getByText("Centred and spaced.");
  await expect(centred).toHaveCSS("text-align", "center");
  await expect(centred).toHaveCSS("line-height", /^(2|3[0-9](\.[0-9]+)?px)$/);
  await expect(editor(page).getByText("<div", { exact: false })).toHaveCount(0);
  await expect(editor(page).locator("img[src*='a.png']")).toHaveCount(1);

  await caretAfter(page, "after.");
  await page.keyboard.type(" Edited.");
  const saved = await lastSave(page, "Formatting.md");
  expect(saved).toContain('<div align="center" style="line-height: 2">\n\nCentred and spaced.\n\n</div>');
  expect(saved).toContain('width="320"');
  expect(saved).toContain('[link](https://example.com "Example")');
});
