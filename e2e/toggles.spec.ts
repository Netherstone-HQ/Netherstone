import { expect, test } from "@playwright/test";
import { caretAfter, editor, lastSave, mockVault } from "./vault";

test("a toggle typed through the / menu is saved with its content", async ({ page }) => {
  await mockVault(page, { files: { "Note.md": "# Note\n\nStart\n" }, open: "Note.md" });
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");

  await page.keyboard.type("/toggle", { delay: 40 });
  await expect(page.getByRole("option", { name: "Toggle" })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("My toggle title");
  // A new toggle starts closed; Enter then adds a sibling toggle. Open it
  // first, as a writer would, so Enter starts a line inside.
  await editor(page).locator(".slate-toggle button").first().click();
  await caretAfter(page, "My toggle title");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Inside the toggle");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain(
    "<details>\n<summary>My toggle title</summary>\n\nInside the toggle\n\n</details>",
  );
});

test("a saved details block opens as a toggle and saves back the same", async ({ page }) => {
  const note =
    "# Note\n\n<details>\n<summary>Title</summary>\n\nHidden line\n\n- hidden item\n\n</details>\n\nAfter\n";
  await mockVault(page, { files: { "Note.md": note }, open: "Note.md" });

  await expect(editor(page)).toContainText("Title");
  await caretAfter(page, "After");
  await page.keyboard.type("!");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toBe(note.replace("After\n", "After!\n"));
});
