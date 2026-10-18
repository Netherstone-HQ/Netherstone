import { expect, test } from "@playwright/test";
import { caretAfter, editor, lastSave, mockVault } from "./vault";

/** Whole-shard saves: what autosave writes after a small edit. */

test("editing a shard with a callout keeps the callout", async ({ page }) => {
  await mockVault(page, {
    files: {
      "Callout.md": '# Callout\n\n<callout icon="💡">\n  Body\n</callout>\n\nEnd\n',
    },
    open: "Callout.md",
  });

  await caretAfter(page, "End");
  await page.keyboard.type(" edited");

  const saved = await lastSave(page, "Callout.md");
  expect(saved).toContain("# Callout");
  expect(saved).toContain('<callout icon="💡">\n  Body\n</callout>');
  expect(saved).not.toContain("id=");
  expect(saved).toContain("End edited");
});

test("empty lines and HTML comments survive an edit", async ({ page }) => {
  const note = "# Note\n\n<!-- keep me -->\n\nOne\n\n<br>\n\nTwo\n";
  await mockVault(page, { files: { "Note.md": note }, open: "Note.md" });

  await expect(editor(page)).toContainText("keep me");
  await caretAfter(page, "Two");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Three");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toBe("# Note\n\n<!-- keep me -->\n\nOne\n\n<br>\n\nTwo\n\n<br>\n\nThree\n");
  expect(saved).not.toContain("\u200B");
});

test("editing a mixed shard keeps every block", async ({ page }) => {
  const note = `# Mixed

Intro with **bold** and a [link](https://example.com).

- one
- two
  - nested

1. first
2. second

> quote

\`\`\`ts
const a = 1;
\`\`\`

| a | b |
| - | - |
| 1 | 2 |

$$
x^2
$$

---

End
`;
  await mockVault(page, { files: { "Mixed.md": note }, open: "Mixed.md" });

  await caretAfter(page, "End");
  await page.keyboard.type("!");

  const saved = await lastSave(page, "Mixed.md");
  expect(saved).toBe(note.replace("End\n", "End!\n"));
  await expect(editor(page).locator("table")).toHaveCount(1);
});
