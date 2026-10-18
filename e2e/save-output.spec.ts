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
  expect(saved).toMatch(/<callout icon="💡"[^>]*>\n  Body\n<\/callout>/);
  expect(saved).toContain("End edited");
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
