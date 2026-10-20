import { caretAfter, editor, expect, lastSave, mockVault, test } from "./vault";

test("front matter is shown read-only and written back unchanged", async ({ page }) => {
  const note = "---\ntitle: Props\ntags: [a, b]\n---\n\n# Note\n\nBody\n";
  await mockVault(page, { files: { "Note.md": note }, open: "Note.md" });

  await expect(editor(page)).toContainText("Front matter");
  await expect(editor(page)).toContainText("title: Props");

  await caretAfter(page, "Body");
  await page.keyboard.type(" edited");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toBe(note.replace("Body\n", "Body edited\n"));
});
