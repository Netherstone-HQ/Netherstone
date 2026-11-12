import { caretAfter, editor, expect, lastSave, mockVault, pickOption, test } from "./vault";

test("a toggle typed through the / menu is saved with its content", async ({ page }) => {
  await mockVault(page, { files: { "Note.md": "# Note\n\nStart\n" }, open: "Note.md" });
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");

  await page.keyboard.type("/toggle");
  await pickOption(page, page.getByRole("option", { name: "Toggle", exact: true }));
  await page.keyboard.type("My toggle title");
  // A new toggle starts open, so Enter starts a line inside it.
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
  // Loaded closed, so its content is hidden.
  await expect(editor(page).getByText("Hidden line")).toBeHidden();
  await caretAfter(page, "After");
  await page.keyboard.type("!");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toBe(note.replace("After\n", "After!\n"));
});

test("closing a toggle hides its content, in a shard that had no toggles", async ({ page }) => {
  await mockVault(page, { files: { "Note.md": "# Note\n\nStart\n" }, open: "Note.md" });
  await caretAfter(page, "Start");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/toggle");
  await pickOption(page, page.getByRole("option", { name: "Toggle", exact: true }));
  await page.keyboard.type("Title");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Inside the toggle");

  const inside = editor(page).getByText("Inside the toggle");
  const arrow = editor(page).locator("button:has(svg.lucide-chevron-right)");
  await arrow.click();
  await expect(inside).toBeHidden();
  await arrow.click();
  await expect(inside).toBeVisible();
});
